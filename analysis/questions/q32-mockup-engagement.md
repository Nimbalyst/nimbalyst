# Mockup Engagement - Active Edit vs Passive View Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

Are users actively editing mockups or just viewing them? Track the ratio of edit events (drawing, annotation, layout changes) to view events, time spent in edit mode vs. view mode, and whether engagement patterns differ between user-created vs. AI-generated mockups.

---

## 2. Queries Used

### Query 1: Edit vs. View Event Distribution
```sql
SELECT
  event as interaction_type,
  count(*) as event_count,
  count(DISTINCT person_id) as unique_users,
  count(DISTINCT properties.mockup_id) as unique_mockups,
  round(count(*) * 100.0 / sum(count(*)) OVER (), 2) as pct_of_total_events
FROM events
WHERE event IN ('mockup_viewed', 'mockup_edited', 'mockup_annotation_added', 'mockup_element_added', 'mockup_layout_changed')
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY event
ORDER BY event_count DESC
```

### Query 2: User Engagement Patterns
```sql
WITH user_mockup_events AS (
  SELECT person_id,
         countIf(event = 'mockup_viewed') as view_count,
         countIf(event IN ('mockup_edited', 'mockup_annotation_added', 'mockup_element_added', 'mockup_layout_changed')) as edit_count,
         count(*) as total_mockup_events
  FROM events
  WHERE event IN ('mockup_viewed', 'mockup_edited', 'mockup_annotation_added', 'mockup_element_added', 'mockup_layout_changed')
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT
  CASE
    WHEN edit_count = 0 THEN 'view_only'
    WHEN edit_count > 0 AND edit_count < view_count THEN 'mostly_viewing'
    WHEN edit_count >= view_count AND edit_count < view_count * 3 THEN 'balanced'
    ELSE 'mostly_editing'
  END as engagement_type,
  count(*) as user_count,
  round(avg(view_count), 1) as avg_views,
  round(avg(edit_count), 1) as avg_edits,
  round(avg(edit_count * 1.0 / GREATEST(view_count, 1)), 2) as avg_edit_to_view_ratio
FROM user_mockup_events
GROUP BY engagement_type
ORDER BY user_count DESC
```

### Query 3: Time in Edit Mode vs. View Mode
```sql
WITH mockup_sessions AS (
  SELECT properties.mockup_id,
         properties.session_id,
         person_id,
         properties.mode, -- 'edit' or 'view'
         min(timestamp) as mode_start,
         max(timestamp) as mode_end,
         dateDiff('second', min(timestamp), max(timestamp)) as duration_seconds
  FROM events
  WHERE event IN ('mockup_mode_changed', 'mockup_viewed', 'mockup_edited')
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY properties.mockup_id, properties.session_id, person_id, properties.mode
)
SELECT mode,
       count(DISTINCT mockup_id) as mockups_in_mode,
       count(DISTINCT person_id) as unique_users,
       sum(duration_seconds) as total_seconds,
       round(avg(duration_seconds), 1) as avg_duration_seconds,
       round(sum(duration_seconds) * 100.0 / (SELECT sum(duration_seconds) FROM mockup_sessions), 2) as pct_of_total_time
FROM mockup_sessions
WHERE duration_seconds > 0
GROUP BY mode
```

### Query 4: User-Created vs. AI-Generated Mockup Engagement
```sql
WITH mockup_metadata AS (
  SELECT DISTINCT properties.mockup_id,
         properties.creation_source -- 'user' or 'ai'
  FROM events
  WHERE event = 'mockup_created'
    AND timestamp >= now() - INTERVAL 90 DAY
),
engagement_by_source AS (
  SELECT mm.creation_source,
         e.event,
         count(*) as event_count,
         count(DISTINCT e.person_id) as unique_users
  FROM events e
  JOIN mockup_metadata mm ON e.properties.mockup_id = mm.mockup_id
  WHERE e.event IN ('mockup_viewed', 'mockup_edited', 'mockup_annotation_added', 'mockup_element_added', 'mockup_layout_changed')
    AND e.timestamp >= now() - INTERVAL 90 DAY
  GROUP BY mm.creation_source, e.event
)
SELECT creation_source,
       sum(event_count) as total_events,
       sum(unique_users) as total_unique_users,
       sumIf(event_count, event = 'mockup_viewed') as views,
       sumIf(event_count, event != 'mockup_viewed') as edits,
       round(sumIf(event_count, event != 'mockup_viewed') * 100.0 / sum(event_count), 2) as pct_edit_events
FROM engagement_by_source
GROUP BY creation_source
```

### Query 5: Edit Action Types
```sql
SELECT
  CASE
    WHEN event = 'mockup_annotation_added' THEN 'annotation'
    WHEN event = 'mockup_element_added' THEN 'add_element'
    WHEN event = 'mockup_layout_changed' THEN 'layout_change'
    WHEN event = 'mockup_style_changed' THEN 'style_change'
    ELSE 'other_edit'
  END as edit_type,
  count(*) as action_count,
  count(DISTINCT person_id) as unique_users,
  count(DISTINCT properties.mockup_id) as unique_mockups
FROM events
WHERE event IN ('mockup_annotation_added', 'mockup_element_added', 'mockup_layout_changed', 'mockup_style_changed', 'mockup_edited')
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY edit_type
ORDER BY action_count DESC
```

### Query 6: Mockup Stickiness (Repeat Engagement)
```sql
WITH mockup_users AS (
  SELECT properties.mockup_id,
         person_id,
         count(DISTINCT date(timestamp)) as days_engaged,
         count(*) as total_interactions,
         countIf(event != 'mockup_viewed') as edit_interactions
  FROM events
  WHERE event IN ('mockup_viewed', 'mockup_edited', 'mockup_annotation_added', 'mockup_element_added', 'mockup_layout_changed')
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY properties.mockup_id, person_id
)
SELECT
  CASE
    WHEN days_engaged = 1 THEN 'one_time'
    WHEN days_engaged <= 3 THEN 'short_term'
    WHEN days_engaged <= 7 THEN 'medium_term'
    ELSE 'long_term'
  END as engagement_duration,
  count(*) as mockup_user_pairs,
  round(avg(total_interactions), 1) as avg_interactions,
  round(avg(edit_interactions), 1) as avg_edits,
  round(avg(edit_interactions * 100.0 / total_interactions), 2) as avg_pct_edits
FROM mockup_users
GROUP BY engagement_duration
ORDER BY
  CASE engagement_duration
    WHEN 'one_time' THEN 1
    WHEN 'short_term' THEN 2
    WHEN 'medium_term' THEN 3
    WHEN 'long_term' THEN 4
  END
```

---

## 3. Raw Results

### Edit vs. View Event Distribution

| Interaction Type | Event Count | Unique Users | Unique Mockups | % of Total |
|-----------------|------------|-------------|---------------|-----------|
| mockup_viewed | [TBD] | [TBD] | [TBD] | [TBD]% |
| mockup_edited | [TBD] | [TBD] | [TBD] | [TBD]% |
| mockup_annotation_added | [TBD] | [TBD] | [TBD] | [TBD]% |
| mockup_element_added | [TBD] | [TBD] | [TBD] | [TBD]% |
| mockup_layout_changed | [TBD] | [TBD] | [TBD] | [TBD]% |

### User Engagement Patterns

| Engagement Type | User Count | Avg Views | Avg Edits | Avg Edit:View Ratio |
|----------------|-----------|----------|----------|-------------------|
| view_only | [TBD] | [TBD] | 0 | 0.0 |
| mostly_viewing | [TBD] | [TBD] | [TBD] | [TBD] |
| balanced | [TBD] | [TBD] | [TBD] | [TBD] |
| mostly_editing | [TBD] | [TBD] | [TBD] | [TBD] |

### Time in Edit vs. View Mode

| Mode | Mockups | Users | Total Time | Avg Duration (sec) | % of Total Time |
|------|---------|-------|-----------|-------------------|----------------|
| view | [TBD] | [TBD] | [TBD] | [TBD] | [TBD]% |
| edit | [TBD] | [TBD] | [TBD] | [TBD] | [TBD]% |

### User-Created vs. AI-Generated Engagement

| Creation Source | Total Events | Users | Views | Edits | % Edit Events |
|----------------|-------------|-------|-------|-------|--------------|
| user | [TBD] | [TBD] | [TBD] | [TBD] | [TBD]% |
| ai | [TBD] | [TBD] | [TBD] | [TBD] | [TBD]% |

### Edit Action Types

| Edit Type | Action Count | Unique Users | Unique Mockups |
|----------|-------------|-------------|---------------|
| annotation | [TBD] | [TBD] | [TBD] |
| add_element | [TBD] | [TBD] | [TBD] |
| layout_change | [TBD] | [TBD] | [TBD] |
| style_change | [TBD] | [TBD] | [TBD] |

### Mockup Stickiness

| Engagement Duration | Mockup-User Pairs | Avg Interactions | Avg Edits | Avg % Edits |
|--------------------|------------------|----------------|----------|------------|
| one_time | [TBD] | [TBD] | [TBD] | [TBD]% |
| short_term (2-3 days) | [TBD] | [TBD] | [TBD] | [TBD]% |
| medium_term (4-7 days) | [TBD] | [TBD] | [TBD] | [TBD]% |
| long_term (8+ days) | [TBD] | [TBD] | [TBD] | [TBD]% |

---

## 4. Visualizations

### Recommended Charts

1. **Pie Chart: Event Distribution**
   - Segments: View, Edit, Annotation, Element, Layout
   - Shows balance of passive vs. active engagement

2. **Grouped Bar Chart: User Engagement Patterns**
   - X-axis: Engagement types
   - Y-axis: User count
   - Shows how many users are active editors

3. **Stacked Bar Chart: Time in Edit vs. View Mode**
   - Two bars: View time, Edit time
   - Shows which mode dominates

4. **Comparison Chart: User vs. AI Mockup Engagement**
   - Side-by-side for user-created vs. AI-generated
   - Metrics: Views, Edits, Edit %
   - Shows if creation source affects engagement

5. **Waterfall Chart: Edit Action Breakdown**
   - Shows contribution of each edit type
   - Highlights most common actions

---

## 5. Takeaways

### Expected Findings

1. **Passive vs. active usage:**
   - If view-only users >50%: Mockups used for reference/sharing
   - If active editors >50%: Mockups used as collaborative tool

2. **Edit:view ratio:**
   - Target: >0.3 (3 edits per 10 views) for active engagement
   - <0.1 suggests mockups are mostly read-only

3. **AI-generated mockups:**
   - Likely more views than edits (used as starting point)
   - User-created likely more edits (iterative design)

### Potential Insights

4. **Time distribution:**
   - If 80%+ time in view mode: Feature is presentation tool
   - If balanced: True collaborative editing

5. **Sticky mockups:**
   - Long-term engagement indicates valuable feature
   - One-time usage suggests failed value prop

6. **Edit types:**
   - If annotations dominate: Used for review/feedback
   - If elements dominate: Used for design work
   - If layout dominates: Used for wireframing

---

## 6. Suggested Actions / Product Direction

### If Mostly Passive Viewing

1. **Optimize for viewing:**
   - Better presentation mode
   - Export/share capabilities
   - Commenting without editing

2. **Encourage editing:**
   - Lower friction for first edit
   - Templates and suggestions
   - "Make a copy to edit" for AI mockups

### If Editing is Popular

3. **Enhance editing features:**
   - More element types
   - Better annotation tools
   - Collaborative editing
   - Version history

4. **Improve edit UX:**
   - Faster loading in edit mode
   - Better keyboard shortcuts
   - Undo/redo improvements

### If AI Mockups Have Low Engagement

5. **Make AI mockups more editable:**
   - Clearer "customize this" prompts
   - Easy modification pathways
   - Save modified versions

6. **Better AI mockup quality:**
   - More accurate initial generation
   - Better match user intent
   - Fewer edits needed

### If User-Created Mockups Dominate

7. **Improve creation flow:**
   - Faster mockup creation
   - Better templates
   - AI assistance for user-created mockups

### General Improvements

8. **Track edit depth:**
   - Are users making substantial changes or just tweaks?
   - Measure edit impact on final mockup

9. **Engagement loops:**
   - Notify users when mockup is viewed
   - Encourage iteration
   - Suggest improvements

10. **Feature prioritization:**
    - Focus on most-used edit types
    - Remove rarely-used features
    - Streamline common workflows

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `mockup_viewed`, `mockup_edited`, `mockup_annotation_added`, `mockup_element_added`, `mockup_layout_changed`, `mockup_style_changed`
- **Mode Duration:** Calculated from mode_changed events or inferred from event sequence
- **Creation Source:** Tracked at mockup creation time
- **Stickiness:** Measured by unique days engaged per mockup-user pair
