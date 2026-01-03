# Batch AI Operations and Multi-File Workflows

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users leverage AI for batch operations across multiple files? Analyze usage of multi-file edits, batch renames, bulk refactoring, and project-wide search-and-replace. Identify patterns in batch operation size, success rates, and rollback frequency.

---

## 2. Queries Used

### Query 1: Batch Operation Events
```sql
-- Track ai_batch_operation_started events
-- Group by operation type (multi_file_edit, bulk_rename, refactor, etc.)
```

### Query 2: Batch Size Distribution
```sql
-- Count number of files affected per batch operation
-- Histogram of batch sizes (1-5, 6-10, 11-20, 20+ files)
```

### Query 3: Batch Operation Success Rate
```sql
-- ai_batch_operation_completed vs ai_batch_operation_failed
-- Calculate success rate by operation type
```

### Query 4: Rollback Frequency
```sql
-- Track undo/rollback events after batch operations
-- Measure within 5 minutes of batch completion
```

### Query 5: Batch Operation → Session Duration
```sql
-- Correlation between batch operations and extended sessions
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Histogram: Batch Operation Size Distribution**
2. **Bar Chart: Success Rate by Operation Type**
3. **Time Series: Batch Operations Over Time**
4. **Funnel: Batch Start → Completion → Rollback**

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
- **Batch Events:** Based on ai_batch_operation events
