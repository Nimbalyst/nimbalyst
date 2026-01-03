# Power vs Casual User Editing Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

What distinguishes power users from casual users in terms of editing patterns? Compare metrics like daily file edit count, session duration, AI interaction frequency, feature breadth usage, and multi-window workflows. Identify behavioral thresholds that define power users vs casual users.

---

## 2. Queries Used

### Query 1: User Segmentation by Edit Volume
```sql
-- Segment users by total file edits in 90 days
-- Categories: Casual (1-10 edits), Regular (11-50), Power (51-200), Super (200+)
```

### Query 2: Feature Breadth by User Segment
```sql
-- Count distinct features used per user segment
-- Features: AI tools, slash commands, MCP servers, extensions, file types
```

### Query 3: Session Duration Distribution
```sql
-- Average session duration by user segment
-- Compare median, p75, p90, p95 session lengths
```

### Query 4: Multi-Window Usage
```sql
-- Percentage of users with multiple concurrent windows
-- Split by user segment
```

### Query 5: AI Interaction Density
```sql
-- AI messages per editing session by user segment
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Histogram: User Distribution by Edit Volume**
2. **Radar Chart: Power User vs Casual Feature Usage**
3. **Box Plot: Session Duration by User Segment**
4. **Stacked Bar: Feature Breadth Across Segments**

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
- **Segmentation Logic:** Define thresholds based on edit volume distribution
