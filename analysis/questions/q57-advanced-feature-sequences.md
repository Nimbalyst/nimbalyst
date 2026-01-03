# Advanced Feature Usage Sequences

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

What sequences of advanced features do power users employ? Analyze multi-step workflows like: search → AI edit → commit → push, or MCP tool → file edit → extension action. Identify common feature chains and whether specific sequences correlate with task success.

---

## 2. Queries Used

### Query 1: Feature Sequence Mining
```sql
-- Track event sequences within sessions
-- Identify common 3-5 step patterns
```

### Query 2: High-Value Sequences
```sql
-- Correlate sequences with task completion (commits, saves, etc.)
-- Identify sequences with >80% completion rate
```

### Query 3: Sequence Complexity by User
```sql
-- Average sequence length by user segment
-- Power users likely have longer, more complex sequences
```

### Query 4: Sequence Bottlenecks
```sql
-- Identify where users drop off mid-sequence
-- Calculate completion rate for each step
```

### Query 5: Sequence Discovery Methods
```sql
-- How users discover advanced sequences (onboarding, trial, AI suggestion)
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Sankey: Top Feature Sequences**
2. **Funnel: Sequence Completion Rates**
3. **Network Graph: Feature Relationships**
4. **Bar Chart: Sequence Length Distribution**

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
- **Sequence Mining:** Based on event timestamps within sessions
