# Database Error Impact on User Retention

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do database errors impact user retention and engagement? Compare retention curves for users who experience db_error events vs those who don't. Analyze error severity, frequency, and recovery success in relation to churn risk. Identify error patterns that predict abandonment.

---

## 2. Queries Used

### Query 1: DB Error Incidence
```sql
-- Count users who experienced db_error events
-- Group by error type and severity
```

### Query 2: Retention Cohort Analysis
```sql
-- Compare 7-day and 30-day retention
-- Cohorts: No errors, 1 error, 2-5 errors, 5+ errors
```

### Query 3: Error Frequency and Churn
```sql
-- Calculate churn rate by error count
-- Identify threshold where churn spikes
```

### Query 4: Error Recovery and Retention
```sql
-- Users who successfully recovered vs those who didn't
-- Impact on subsequent engagement
```

### Query 5: Error Type Severity Ranking
```sql
-- Rank error types by retention impact
-- Identify most damaging error types
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Cohort Retention: By Error Count**
2. **Bar Chart: Churn Rate by Error Type**
3. **Line Chart: Engagement Drop After Errors**
4. **Scatter: Error Frequency vs Days Active**

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
- **Error Events:** Based on db_error events with severity metadata
