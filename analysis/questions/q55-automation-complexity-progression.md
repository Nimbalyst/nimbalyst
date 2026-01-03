# Automation Complexity Progression

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users progress from simple to complex automation tasks? Analyze the journey from basic AI prompts to multi-step workflows, MCP tool chains, and custom extension development. Identify skill progression milestones and barriers to advanced automation.

---

## 2. Queries Used

### Query 1: Automation Complexity Ladder
```sql
-- Classify user tasks by complexity level
-- Levels: Simple prompt, Multi-turn, Tool-assisted, Multi-tool chain, Custom extension
```

### Query 2: Time to Complexity Progression
```sql
-- Measure time from first session to each complexity milestone
-- Track progression speed by user
```

### Query 3: Complexity Barriers
```sql
-- Identify users stuck at each complexity level
-- Calculate drop-off rates between levels
```

### Query 4: Power User Automation Patterns
```sql
-- Analyze top 10% of users by automation complexity
-- Identify common advanced patterns
```

### Query 5: Learning Resources Correlation
```sql
-- Track documentation views, tutorial completions
-- Correlate with automation complexity progression
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Sankey: Complexity Progression Flow**
2. **Cohort Retention: By Complexity Level**
3. **Histogram: Time to Advanced Automation**
4. **Stacked Area: Complexity Distribution Over Time**

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
- **Complexity Classification:** Based on task event sequences
