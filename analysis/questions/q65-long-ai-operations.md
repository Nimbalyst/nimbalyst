# Long-Running AI Operations Behavior

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users interact with long-running AI operations (>30 seconds)? Analyze cancellation behavior, multitasking during waits, and satisfaction with long operations. Identify which operations most frequently exceed user patience thresholds and whether progress indicators improve completion rates.

---

## 2. Queries Used

### Query 1: Long Operation Frequency
```sql
-- Track ai_message_sent events with response_time >30s
-- Categorize by operation type (code generation, analysis, etc.)
```

### Query 2: Cancellation Patterns
```sql
-- Count ai_operation_cancelled events
-- Measure time from start to cancellation
```

### Query 3: Multitasking During Waits
```sql
-- Track concurrent events during long AI operations
-- File switches, new sessions, etc.
```

### Query 4: Completion Rate by Duration
```sql
-- Calculate completion rate for operations by duration bucket
-- <10s, 10-30s, 30-60s, 60-120s, 120+ s
```

### Query 5: Progress Indicator Impact
```sql
-- Compare completion rates with/without progress indicators
-- A/B test or feature flag data
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Histogram: AI Operation Duration Distribution**
2. **Line Chart: Completion Rate by Duration**
3. **Bar Chart: Cancellation Rate by Operation Type**
4. **Funnel: Long Operation → Progress Check → Completion/Cancel**

---

## 5. Takeaways

[Analysis pending]

---

## 6. Suggested Actions / Product Direction

[Recommendations pending]

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` cohort, `is_dev_user = true`, test accounts
- **Time Period:** 90-day rolling window
- **Duration Tracking:** Based on ai_message_sent response_time property
