# Scripting and Macro Creation Behavior

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users create and use scripts/macros for repetitive tasks? Analyze script creation frequency, execution patterns, and automation savings. Identify which repetitive tasks are most commonly automated and whether scripting correlates with power user status.

---

## 2. Queries Used

### Query 1: Script Creation Events
```sql
-- Track script_created, macro_created events
-- Group by script type (bash, python, node, etc.)
```

### Query 2: Script Execution Frequency
```sql
-- Count script_executed events per script ID
-- Identify most-run scripts
```

### Query 3: Time Saved by Automation
```sql
-- Estimate time saved: manual task time vs script execution time
-- Aggregate across all script executions
```

### Query 4: Script Sharing and Collaboration
```sql
-- Track script_shared events
-- Measure team-wide automation adoption
```

### Query 5: Scripting → Retention
```sql
-- Compare retention for users who create scripts vs those who don't
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Bar Chart: Script Types by Creation Count**
2. **Histogram: Scripts per User**
3. **Line Chart: Script Executions Over Time**
4. **Scatter: Script Count vs User Retention**

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
- **Script Events:** Based on script_created, script_executed
