# Extension Installation and Usage Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

What drives extension adoption? Analyze installation funnel, time to first extension use, and which extensions have highest activation rates. Compare built-in vs third-party extensions. Identify users who install multiple extensions and their engagement patterns.

---

## 2. Queries Used

### Query 1: Extension Install → Activation Funnel
```sql
-- extension_installed → extension_activated → extension_feature_used
-- Calculate conversion rates
```

### Query 2: Most Installed Extensions
```sql
-- Count installations by extension ID
-- Compare built-in vs third-party
```

### Query 3: Time to First Extension Use
```sql
-- Measure time from extension_installed to first feature use
-- Group by extension type
```

### Query 4: Multi-Extension Users
```sql
-- Users who install 2+ extensions
-- Identify extension power users
```

### Query 5: Extension Discovery Methods
```sql
-- Track how users find extensions (marketplace, AI suggestion, docs)
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Funnel: Extension Install → Activation → Usage**
2. **Bar Chart: Top Extensions by Installation Count**
3. **Histogram: Time to First Extension Feature Use**
4. **Venn Diagram: Extension Combination Patterns**

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
- **Extension Events:** Based on extension_installed, extension_feature_used
