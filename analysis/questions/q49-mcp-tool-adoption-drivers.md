# MCP Tool Adoption Drivers

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

What drives MCP tool adoption? Analyze the user journey from MCP server installation to first tool execution. Identify drop-off points, time to first tool use, and which MCP servers have highest activation rates. Compare tool discovery methods (documentation, AI suggestion, manual exploration).

---

## 2. Queries Used

### Query 1: MCP Server Installation Funnel
```sql
-- mcp_server_added → mcp_server_connected → mcp_tool_executed
-- Calculate drop-off at each stage
```

### Query 2: Time to First Tool Execution
```sql
-- Measure time from mcp_server_added to first mcp_tool_executed
-- Group by server name
```

### Query 3: MCP Server Activation Rates
```sql
-- % of users who execute tools after installing each server
-- Compare GitHub, Filesystem, Brave, Postgres, etc.
```

### Query 4: Tool Discovery Methods
```sql
-- Track how users discover tools (AI suggestion, docs link, manual)
-- Correlate with tool usage frequency
```

### Query 5: Multi-Tool Users
```sql
-- Users who execute tools from multiple MCP servers
-- Identify power MCP users
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Funnel: MCP Server Install → Connection → Tool Use**
2. **Bar Chart: Activation Rate by MCP Server**
3. **Histogram: Time to First Tool Execution**
4. **Heatmap: Tool Discovery Method vs Usage Frequency**

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
- **MCP Events:** Based on mcp_server_added, mcp_tool_executed, etc.
