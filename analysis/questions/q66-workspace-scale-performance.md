# Workspace Scale and Performance Impact

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How does workspace size impact performance and user experience? Analyze relationship between file count, workspace size (MB/GB), and metrics like search latency, file open time, and AI indexing duration. Identify performance degradation thresholds and whether users with large workspaces churn more.

---

## 2. Queries Used

### Query 1: Workspace Size Distribution
```sql
-- Track workspace_opened events with file_count and size_mb properties
-- Histogram of workspace sizes
```

### Query 2: Performance Metrics by Workspace Size
```sql
-- Correlate workspace size with search_latency, file_open_latency
-- Group by size buckets: <100 files, 100-500, 500-1000, 1000+ files
```

### Query 3: AI Indexing Performance
```sql
-- Track ai_index_completed events with duration property
-- Correlate with workspace size
```

### Query 4: Large Workspace User Retention
```sql
-- Compare retention for users with large (1000+ files) vs small workspaces
```

### Query 5: Performance Complaints
```sql
-- Track performance_issue_reported events
-- Correlate with workspace size
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Scatter: Workspace Size vs Search Latency**
2. **Box Plot: File Open Time by Workspace Size Bucket**
3. **Histogram: Workspace File Count Distribution**
4. **Cohort Retention: By Workspace Size**

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
- **Performance Metrics:** Based on workspace_opened, search_latency events
