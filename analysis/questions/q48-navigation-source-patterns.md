# Navigation Source Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users navigate to files within Nimbalyst? Compare navigation sources: file tree clicks, search results, recent files list, AI-suggested files, MCP tool file opens. Identify which navigation methods correlate with longer editing sessions and higher productivity.

---

## 2. Queries Used

### Query 1: File Open Events by Source
```sql
-- Track file_opened events with source property
-- Sources: tree, search, recent, ai_suggestion, mcp_tool, external
```

### Query 2: Navigation Source by User Segment
```sql
-- Compare navigation source distribution for power vs casual users
```

### Query 3: Time to File Open by Source
```sql
-- Measure time from session start to first file open
-- Compare across navigation sources
```

### Query 4: Navigation Source → Session Duration
```sql
-- Correlation between navigation method and subsequent editing duration
```

### Query 5: Search vs Tree Navigation Trends
```sql
-- Time series of search-driven vs tree-driven navigation
-- Identify if users transition from tree to search over time
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Pie Chart: Navigation Source Distribution**
2. **Line Chart: Search vs Tree Usage Over Time**
3. **Box Plot: Session Duration by Navigation Source**
4. **Funnel: Navigation Method → Editing → Save**

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
- **Source Tracking:** Based on file_opened event source property
