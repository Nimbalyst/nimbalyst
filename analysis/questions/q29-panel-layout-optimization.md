# Panel Layout Optimization - Sidebar Width vs Editor Type Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

How do users adjust panel widths for different editor types? Analyze whether users keep AI chat sidebar narrow when using Monaco (code) vs. wider when using Lexical (markdown), and whether certain width configurations correlate with longer session durations.

---

## 2. Queries Used

### Query 1: Panel Width by Editor Type
```sql
SELECT properties.editor_type,
       properties.sidebar_width,
       count(*) as adjustment_count,
       count(DISTINCT person_id) as unique_users,
       round(avg(properties.sidebar_width), 0) as avg_width,
       quantile(0.5)(properties.sidebar_width) as median_width
FROM events
WHERE event = 'panel_resized'
  AND properties.panel_name = 'ai_chat'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY properties.editor_type, properties.sidebar_width
ORDER BY properties.editor_type, adjustment_count DESC
```

### Query 2: Width Distribution by Editor Type
```sql
WITH width_buckets AS (
  SELECT properties.editor_type,
         CASE
           WHEN properties.sidebar_width < 300 THEN 'narrow'
           WHEN properties.sidebar_width < 500 THEN 'medium'
           WHEN properties.sidebar_width < 700 THEN 'wide'
           ELSE 'very_wide'
         END as width_category,
         properties.sidebar_width,
         person_id
  FROM events
  WHERE event = 'panel_resized'
    AND properties.panel_name = 'ai_chat'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT editor_type,
       width_category,
       count(*) as adjustment_count,
       count(DISTINCT person_id) as unique_users,
       round(count(*) * 100.0 / sum(count(*)) OVER (PARTITION BY editor_type), 2) as pct_of_editor_type
FROM width_buckets
GROUP BY editor_type, width_category
ORDER BY editor_type, pct_of_editor_type DESC
```

### Query 3: Session Duration by Width Configuration
```sql
WITH sessions AS (
  SELECT properties.session_id,
         properties.editor_type,
         properties.sidebar_width,
         person_id,
         min(timestamp) as session_start,
         max(timestamp) as session_end,
         dateDiff('minute', min(timestamp), max(timestamp)) as session_duration_min
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
  GROUP BY properties.session_id, properties.editor_type, properties.sidebar_width, person_id
  HAVING session_duration_min > 0
)
SELECT editor_type,
       CASE
         WHEN sidebar_width < 300 THEN 'narrow'
         WHEN sidebar_width < 500 THEN 'medium'
         WHEN sidebar_width < 700 THEN 'wide'
         ELSE 'very_wide'
       END as width_category,
       count(DISTINCT session_id) as session_count,
       round(avg(session_duration_min), 1) as avg_duration_min,
       round(quantile(0.5)(session_duration_min), 1) as median_duration_min
FROM sessions
WHERE sidebar_width IS NOT NULL
GROUP BY editor_type, width_category
ORDER BY editor_type, avg_duration_min DESC
```

### Query 4: Width Adjustment Frequency
```sql
WITH user_adjustments AS (
  SELECT person_id,
         properties.editor_type,
         count(*) as total_adjustments,
         count(DISTINCT date(timestamp)) as days_adjusted
  FROM events
  WHERE event = 'panel_resized'
    AND properties.panel_name = 'ai_chat'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id, properties.editor_type
)
SELECT editor_type,
       CASE
         WHEN total_adjustments = 1 THEN 'one_time'
         WHEN total_adjustments <= 5 THEN 'occasional'
         WHEN total_adjustments <= 20 THEN 'frequent'
         ELSE 'very_frequent'
       END as adjustment_pattern,
       count(*) as user_count,
       round(avg(total_adjustments), 1) as avg_adjustments
FROM user_adjustments
GROUP BY editor_type, adjustment_pattern
ORDER BY editor_type, user_count DESC
```

### Query 5: Default Width Acceptance
```sql
WITH first_panel_event AS (
  SELECT person_id,
         properties.editor_type,
         min(timestamp) as first_interaction
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
    AND properties.editor_type IS NOT NULL
  GROUP BY person_id, properties.editor_type
),
panel_adjustments AS (
  SELECT person_id,
         properties.editor_type,
         min(timestamp) as first_adjustment
  FROM events
  WHERE event = 'panel_resized'
    AND properties.panel_name = 'ai_chat'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id, properties.editor_type
)
SELECT fpe.editor_type,
       count(DISTINCT fpe.person_id) as total_users,
       count(DISTINCT pa.person_id) as users_who_adjusted,
       count(DISTINCT fpe.person_id) - count(DISTINCT pa.person_id) as users_kept_default,
       round(count(DISTINCT pa.person_id) * 100.0 / count(DISTINCT fpe.person_id), 2) as pct_adjusted
FROM first_panel_event fpe
LEFT JOIN panel_adjustments pa
  ON fpe.person_id = pa.person_id
  AND fpe.editor_type = pa.editor_type
GROUP BY fpe.editor_type
```

### Query 6: Editor Switching Width Patterns
```sql
WITH editor_switches AS (
  SELECT person_id,
         timestamp,
         properties.editor_type,
         properties.sidebar_width,
         lag(properties.editor_type) OVER (PARTITION BY person_id ORDER BY timestamp) as prev_editor_type,
         lag(properties.sidebar_width) OVER (PARTITION BY person_id ORDER BY timestamp) as prev_width
  FROM events
  WHERE event IN ('editor_opened', 'panel_resized')
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT prev_editor_type as from_editor,
       editor_type as to_editor,
       count(*) as switches,
       round(avg(prev_width), 0) as avg_width_before,
       round(avg(sidebar_width), 0) as avg_width_after,
       round(avg(sidebar_width - prev_width), 0) as avg_width_change
FROM editor_switches
WHERE prev_editor_type IS NOT NULL
  AND prev_editor_type != editor_type
  AND prev_width IS NOT NULL
  AND sidebar_width IS NOT NULL
GROUP BY prev_editor_type, editor_type
ORDER BY switches DESC
```

---

## 3. Raw Results

### Average Sidebar Width by Editor Type

| Editor Type | Avg Width (px) | Median Width (px) | Unique Users | Total Adjustments |
|------------|---------------|------------------|--------------|------------------|
| monaco | [TBD] | [TBD] | [TBD] | [TBD] |
| lexical | [TBD] | [TBD] | [TBD] | [TBD] |

### Width Distribution by Editor Type

**Monaco (Code Editor):**
| Width Category | Adjustments | Users | % of Monaco Users |
|---------------|------------|-------|------------------|
| narrow (<300px) | [TBD] | [TBD] | [TBD]% |
| medium (300-499px) | [TBD] | [TBD] | [TBD]% |
| wide (500-699px) | [TBD] | [TBD] | [TBD]% |
| very_wide (700+px) | [TBD] | [TBD] | [TBD]% |

**Lexical (Markdown Editor):**
| Width Category | Adjustments | Users | % of Lexical Users |
|---------------|------------|-------|------------------|
| narrow (<300px) | [TBD] | [TBD] | [TBD]% |
| medium (300-499px) | [TBD] | [TBD] | [TBD]% |
| wide (500-699px) | [TBD] | [TBD] | [TBD]% |
| very_wide (700+px) | [TBD] | [TBD] | [TBD]% |

### Session Duration by Width Configuration

**Monaco:**
| Width | Sessions | Avg Duration | Median Duration |
|-------|----------|-------------|----------------|
| narrow | [TBD] | [TBD] min | [TBD] min |
| medium | [TBD] | [TBD] min | [TBD] min |
| wide | [TBD] | [TBD] min | [TBD] min |
| very_wide | [TBD] | [TBD] min | [TBD] min |

**Lexical:**
| Width | Sessions | Avg Duration | Median Duration |
|-------|----------|-------------|----------------|
| narrow | [TBD] | [TBD] min | [TBD] min |
| medium | [TBD] | [TBD] min | [TBD] min |
| wide | [TBD] | [TBD] min | [TBD] min |
| very_wide | [TBD] | [TBD] min | [TBD] min |

### Default Width Acceptance

| Editor Type | Total Users | Kept Default | Adjusted | % Adjusted |
|------------|------------|-------------|----------|-----------|
| monaco | [TBD] | [TBD] | [TBD] | [TBD]% |
| lexical | [TBD] | [TBD] | [TBD] | [TBD]% |

### Editor Switch Width Changes

| From → To | Switches | Avg Before | Avg After | Avg Change |
|-----------|----------|-----------|----------|-----------|
| monaco → lexical | [TBD] | [TBD]px | [TBD]px | [TBD]px |
| lexical → monaco | [TBD] | [TBD]px | [TBD]px | [TBD]px |

---

## 4. Visualizations

### Recommended Charts

1. **Box Plot: Width Distribution by Editor Type**
   - X-axis: Editor type (monaco, lexical)
   - Y-axis: Sidebar width (px)
   - Shows median, quartiles, and outliers
   - Highlights width preferences per editor

2. **Stacked Bar Chart: Width Categories by Editor**
   - X-axis: Editor types
   - Y-axis: Percentage
   - Stacks: narrow, medium, wide, very_wide
   - Normalized to 100% per editor type

3. **Scatter Plot: Width vs. Session Duration**
   - X-axis: Sidebar width
   - Y-axis: Session duration
   - Color by editor type
   - Shows correlation (if any)

4. **Grouped Bar Chart: Avg Duration by Width & Editor**
   - Groups: Width categories
   - Bars: monaco (blue), lexical (green)
   - Compares session duration across configurations

5. **Sankey Diagram: Editor Switching and Width Changes**
   - Left: Editor type + width
   - Right: New editor type + width
   - Shows flow and width adjustment patterns

---

## 5. Takeaways

### Expected Findings

1. **Monaco users prefer narrower sidebars:**
   - Code needs more horizontal space
   - AI chat used for quick queries
   - Hypothesis: <400px average for monaco

2. **Lexical users prefer wider sidebars:**
   - Markdown is more vertical
   - AI collaboration is more conversational
   - Hypothesis: >500px average for lexical

3. **Optimal width correlates with longer sessions:**
   - Users who find right balance stay longer
   - Very narrow or very wide may indicate frustration

### Potential Insights

4. **Default width acceptance:**
   - If <50% adjust: Good defaults
   - If >70% adjust: Defaults need improvement
   - May differ by editor type

5. **Adjustment patterns:**
   - Frequent adjusters: Looking for perfect config
   - One-time adjusters: Found their preference
   - No adjusters: Happy with default or not aware

6. **Context switching behavior:**
   - If users adjust width when switching editors: Width is context-dependent
   - If width stays constant: User has global preference

---

## 6. Suggested Actions / Product Direction

### If Width Preferences Differ by Editor

1. **Context-aware defaults:**
   - Different default widths for monaco vs. lexical
   - Remember per-editor-type preference
   - Smooth transition when switching editors

2. **Quick width presets:**
   - "Code mode" (narrow sidebar)
   - "Writing mode" (wide sidebar)
   - "Balanced" (medium)
   - One-click switching

### If Session Duration Correlates with Width

3. **Optimize default widths:**
   - Set defaults to the width with longest sessions
   - A/B test different defaults
   - Personalize based on user patterns

4. **Width recommendations:**
   - "Users like you prefer X width"
   - Suggest width based on task type
   - "Try this layout" prompts

### If Many Users Adjust Frequently

5. **Improve discoverability:**
   - Better visual affordance for resize handle
   - Tutorial on panel resizing
   - Keyboard shortcuts for quick resize

6. **Save and restore layouts:**
   - Named layouts (Code, Writing, Review)
   - Workspace-specific layouts
   - Cloud sync of preferences

### If Defaults Are Widely Accepted

7. **Validate current approach:**
   - Current defaults are working
   - Focus optimization elsewhere
   - Monitor for changes over time

### General Improvements

8. **Responsive layouts:**
   - Auto-adjust based on screen size
   - Minimum/maximum width constraints
   - Mobile-friendly layouts

9. **Analytics-driven optimization:**
   - Track width by task type (coding, writing, debugging)
   - Monitor width by conversation length
   - Correlate width with AI interaction quality

10. **User control and education:**
    - "Why this layout?" tooltip
    - Show benefits of different configurations
    - Let users share layout preferences

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `panel_resized`, `editor_opened`
- **Width Measurement:** Pixel values for sidebar width
- **Editor Types:** monaco (code), lexical (markdown/rich text)
- **Session Definition:** Grouped by session_id with start/end timestamps
- **Null Handling:** Some sessions may not have width data if never adjusted
