# File Conflict Clustering and Resolution

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

When and why do file conflicts occur, and how effectively do users resolve them? Analyze file_conflict_detected events, resolution methods (manual merge, accept theirs, accept mine, AI-assisted), and time to resolution. Identify file types and collaboration patterns most prone to conflicts.

---

## 2. Queries Used

### Query 1: Conflict Frequency
```sql
-- Track file_conflict_detected events
-- Group by file type, workspace, and time period
```

### Query 2: Conflict Resolution Methods
```sql
-- Count conflict_resolved events by resolution_method
-- Methods: manual_merge, accept_theirs, accept_mine, ai_assisted
```

### Query 3: Time to Resolution
```sql
-- Measure time from file_conflict_detected to conflict_resolved
-- Compare across resolution methods
```

### Query 4: Conflict-Prone Scenarios
```sql
-- Identify patterns: multi-user editing, sync delays, offline edits
-- Correlate with conflict frequency
```

### Query 5: Conflict Impact on Workflow
```sql
-- Session continuation rate after conflicts
-- Measure disruption to productivity
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Bar Chart: Conflict Resolution Methods**
2. **Histogram: Time to Resolution Distribution**
3. **Heatmap: Conflicts by File Type and Day/Time**
4. **Funnel: Conflict Detection → Resolution → Session Continuation**

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
- **Conflict Events:** Based on file_conflict_detected, conflict_resolved
