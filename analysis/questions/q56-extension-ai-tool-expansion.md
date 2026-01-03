# Extension AI Tool Expansion Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users expand AI capabilities via extension-provided tools? Analyze adoption of extension-contributed AI tools, tool discovery methods, and usage patterns. Compare built-in AI tools vs extension-provided tools in terms of usage frequency and user satisfaction.

---

## 2. Queries Used

### Query 1: Extension AI Tool Usage
```sql
-- Track ai_tool_executed events for extension-provided tools
-- Compare to built-in tool usage
```

### Query 2: Extension Tool Discovery
```sql
-- How users discover extension tools (marketplace, AI suggestion, docs)
-- Conversion from discovery to first use
```

### Query 3: Extension Tool Retention
```sql
-- Repeat usage rate for extension tools
-- Compare to built-in tool retention
```

### Query 4: Tool Combination Patterns
```sql
-- Users who combine built-in + extension tools in workflows
-- Identify synergistic tool combinations
```

### Query 5: Extension Tool Power Users
```sql
-- Users who heavily use extension-provided tools
-- Characterize their behavior patterns
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Grouped Bar: Built-in vs Extension Tool Usage**
2. **Funnel: Extension Install → Tool Discovery → Tool Use**
3. **Heatmap: Tool Combination Frequency**
4. **Line Chart: Extension Tool Adoption Over Time**

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
- **Tool Events:** Based on ai_tool_executed with source metadata
