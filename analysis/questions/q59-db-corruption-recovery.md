# Database Corruption Recovery Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How frequently do users encounter database corruption, and what recovery actions do they take? Analyze db_error events, recovery success rates, and data loss patterns. Identify which operations trigger corruption most often and whether auto-backup features prevent data loss.

---

## 2. Queries Used

### Query 1: DB Corruption Frequency
```sql
-- Track db_error events with error_type='corruption'
-- Count incidents per user and time period
```

### Query 2: Corruption Triggers
```sql
-- Identify events immediately preceding db_error
-- Common patterns: concurrent writes, crashes, large operations
```

### Query 3: Recovery Success Rate
```sql
-- db_recovery_started → db_recovery_completed vs db_recovery_failed
-- Calculate success rate
```

### Query 4: Data Loss Measurement
```sql
-- Track data_loss_reported events
-- Measure severity (files lost, session lost, etc.)
```

### Query 5: Backup Effectiveness
```sql
-- Correlate auto_backup_completed events with recovery success
-- Users with backups vs without
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Time Series: DB Corruption Incidents Over Time**
2. **Funnel: Corruption → Recovery Attempt → Success/Failure**
3. **Bar Chart: Corruption Triggers by Event Type**
4. **Scatter: Backup Frequency vs Recovery Success**

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
- **Error Events:** Based on db_error, db_recovery events
