# Walkthrough Follow-through - Mockup Usage After Completion Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

Do users who complete walkthrough steps continue to use the mockup feature in their regular workflow? Track the percentage of walkthrough completers who create mockups within 7 days, 14 days, and 30 days post-completion.

---

## 2. Queries Used

### Query 1: Walkthrough Completion Events
```
TrendsQuery:
- Event: walkthrough_completed
- Math: unique users
- Date Range: Last 90 days
- Filters: is_dev_user != true, exclude all_filtered_cohorts
```

### Query 2: Mockup Creation Post-Walkthrough
```sql
WITH walkthrough_users AS (
  SELECT person_id,
         min(timestamp) as completion_time
  FROM events
  WHERE event = 'walkthrough_completed'
    AND timestamp >= now() - INTERVAL 90 DAY
    AND person_id NOT IN (SELECT distinct_id FROM persons WHERE properties.is_dev_user = true)
  GROUP BY person_id
),
mockup_usage AS (
  SELECT person_id,
         timestamp as mockup_time
  FROM events
  WHERE event IN ('mockup_created', 'mockup_edited')
    AND timestamp >= now() - INTERVAL 90 DAY
    AND person_id NOT IN (SELECT distinct_id FROM persons WHERE properties.is_dev_user = true)
)
SELECT wu.person_id,
       wu.completion_time,
       min(mu.mockup_time) as first_mockup_after,
       dateDiff('day', wu.completion_time, min(mu.mockup_time)) as days_to_first_mockup
FROM walkthrough_users wu
LEFT JOIN mockup_usage mu
  ON wu.person_id = mu.person_id
  AND mu.mockup_time > wu.completion_time
GROUP BY wu.person_id, wu.completion_time
```

### Query 3: Follow-through Cohorts (7/14/30 Days)
```sql
WITH walkthrough_users AS (
  SELECT person_id,
         min(timestamp) as completion_time
  FROM events
  WHERE event = 'walkthrough_completed'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
),
mockup_usage AS (
  SELECT person_id,
         min(timestamp) as first_mockup
  FROM events
  WHERE event IN ('mockup_created', 'mockup_edited')
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT
  count(DISTINCT wu.person_id) as total_completers,
  countIf(mu.first_mockup IS NOT NULL AND dateDiff('day', wu.completion_time, mu.first_mockup) <= 7) as used_within_7d,
  countIf(mu.first_mockup IS NOT NULL AND dateDiff('day', wu.completion_time, mu.first_mockup) <= 14) as used_within_14d,
  countIf(mu.first_mockup IS NOT NULL AND dateDiff('day', wu.completion_time, mu.first_mockup) <= 30) as used_within_30d,
  countIf(mu.first_mockup IS NULL OR dateDiff('day', wu.completion_time, mu.first_mockup) > 30) as did_not_use
FROM walkthrough_users wu
LEFT JOIN mockup_usage mu ON wu.person_id = mu.person_id
```

### Query 4: Walkthrough Step Completion Funnel
```
FunnelQuery:
- Steps:
  1. walkthrough_started
  2. walkthrough_step_completed (step=mockup_intro)
  3. walkthrough_completed
  4. mockup_created (within 30 days)
- Date Range: Last 90 days
- Conversion window: 30 days
```

---

## 3. Raw Results

### Walkthrough Completion

**Total Walkthrough Completers:** [TBD via Query 1]
**Completion Rate:** [TBD - started vs completed]

### Post-Completion Mockup Usage

| Timeframe | Users Who Used Mockups | % of Completers |
|-----------|------------------------|----------------|
| Within 7 days | [TBD] | [TBD]% |
| Within 14 days | [TBD] | [TBD]% |
| Within 30 days | [TBD] | [TBD]% |
| Never used | [TBD] | [TBD]% |

### Time-to-First-Mockup Distribution

| Time Range | User Count | % of Users |
|-----------|-----------|-----------|
| Same day | [TBD] | [TBD]% |
| 1-3 days | [TBD] | [TBD]% |
| 4-7 days | [TBD] | [TBD]% |
| 8-14 days | [TBD] | [TBD]% |
| 15-30 days | [TBD] | [TBD]% |
| 30+ days | [TBD] | [TBD]% |

### Walkthrough-to-Mockup Funnel

| Funnel Step | Users | Conversion Rate |
|------------|-------|----------------|
| Started walkthrough | [TBD] | 100% |
| Completed mockup step | [TBD] | [TBD]% |
| Completed walkthrough | [TBD] | [TBD]% |
| Created mockup (30d) | [TBD] | [TBD]% |

---

## 4. Visualizations

### Recommended Charts

1. **Bar Chart: Follow-through by Timeframe**
   - X-axis: Time windows (7d, 14d, 30d, never)
   - Y-axis: Percentage of completers
   - Shows decay curve of feature adoption

2. **Histogram: Days to First Mockup**
   - X-axis: Days after walkthrough completion
   - Y-axis: Number of users
   - Bins: 0-1d, 1-3d, 3-7d, 7-14d, 14-30d, 30+d
   - Shows when feature activation happens

3. **Funnel Chart: Walkthrough to Usage**
   - Steps: Started → Mockup step → Completed → Used feature
   - Shows drop-off at each stage

4. **Line Chart: Mockup Usage Over Time Post-Walkthrough**
   - X-axis: Days since completion (0-30)
   - Y-axis: Cumulative % who used mockup
   - Shows adoption curve

---

## 5. Takeaways

### Expected Findings

1. **Feature adoption from walkthrough completers:** [Target: 40-60% within 30 days]
   - High adoption suggests effective training
   - Low adoption suggests disconnect between tutorial and real use cases

2. **Timing patterns:**
   - **Immediate usage (same day):** Indicates tutorial created motivation
   - **Delayed usage (7+ days):** Users waiting for right use case
   - **Never used:** Tutorial didn't demonstrate value proposition

3. **Walkthrough quality indicator:**
   - If <30% use feature within 30 days, walkthrough may not be demonstrating value
   - If >60%, walkthrough is effective at creating habit formation

### Potential Insights

4. **Correlation with retention:** Users who follow through likely have higher retention
5. **Step-specific drop-off:** Identify which walkthrough steps lose users
6. **Feature stickiness:** Repeat mockup usage after first post-walkthrough creation

---

## 6. Suggested Actions / Product Direction

### If Follow-through is Low (<30%)

1. **Improve walkthrough content:**
   - Use more realistic examples
   - Show actual value proposition
   - Add "save for later" option for mockup ideas

2. **Add activation triggers:**
   - Email reminder 3 days post-walkthrough
   - In-app prompt when appropriate context detected
   - Quick-start templates in mockup menu

3. **Track drop-off points:**
   - Which walkthrough step loses the most users?
   - Are users completing but not understanding?

### If Follow-through is High (>50%)

4. **Optimize the conversion window:**
   - Identify ideal time to remind users (e.g., day 3 vs day 7)
   - Add contextual prompts during that window

5. **Build on success:**
   - Add advanced mockup tutorials
   - Create community examples
   - Feature user-created mockups

### General Improvements

6. **Measure walkthrough quality:**
   - Track time spent per step
   - Add comprehension checks
   - Monitor skip rates

7. **Cohort comparison:**
   - Compare retention: walkthrough completers who use feature vs. those who don't
   - Identify power user patterns

8. **Progressive disclosure:**
   - For non-users after 14 days, offer simplified version
   - For active users, show advanced features

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `walkthrough_completed`, `mockup_created`, `mockup_edited`
- **Attribution:** Only counting mockup usage AFTER walkthrough completion
- **Completion Definition:** Full walkthrough completion, not partial steps
