# Custom Tool Widget Usage Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users interact with custom MCP tool widgets vs standard tool responses? Compare usage frequency, task completion rates, and user satisfaction. Identify which tool types benefit most from custom widgets (e.g., file pickers, data visualizations, forms).

---

## 2. Queries Used

### Query 1: Widget-Enabled Tool Usage
```sql
-- Count mcp_tool_executed events for tools with custom widgets
-- Compare to tools without widgets
```

### Query 2: Widget Interaction Events
```sql
-- Track widget-specific interactions (button clicks, form submissions, etc.)
-- Measure engagement depth
```

### Query 3: Widget → Tool Execution Success Rate
```sql
-- Completion rate for tasks using widget UI vs plain text
```

### Query 4: Most Used Widget Types
```sql
-- Categorize widgets by type (file picker, form, chart, etc.)
-- Count usage by type
```

### Query 5: Widget Discovery and Adoption
```sql
-- Time from first tool use to first widget interaction
-- Identify widget discoverability issues
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Bar Chart: Widget vs Non-Widget Tool Usage**
2. **Funnel: Tool Execution → Widget Interaction → Task Completion**
3. **Pie Chart: Widget Type Distribution**
4. **Line Chart: Widget Adoption Over Time**

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
- **Widget Events:** Based on mcp_tool_executed with widget metadata
