# Slash Command vs Direct AI Interaction

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users balance slash commands vs direct AI prompts? Compare usage frequency, session types, task complexity, and success rates. Identify when users prefer structured commands (slash) vs freeform prompting. Analyze if slash command discovery correlates with retention.

---

## 2. Queries Used

### Query 1: Slash Command vs Direct Message Distribution
```sql
-- Count slash_command_executed vs ai_message_sent (non-slash)
-- Group by user and time period
```

### Query 2: Command Type by Task
```sql
-- Classify tasks by command type used
-- Tasks: commit, search, file operations, code generation, etc.
```

### Query 3: Slash Command Discovery Path
```sql
-- Track how users discover slash commands
-- Sources: autocomplete, docs, AI suggestion, trial and error
```

### Query 4: Retention by Command Usage
```sql
-- Compare retention curves for slash-heavy vs direct-prompt-heavy users
```

### Query 5: Session Patterns
```sql
-- Sessions with only slash commands vs only direct vs mixed
-- Identify preferred interaction modes
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Stacked Area: Slash vs Direct Over Time**
2. **Bar Chart: Task Type by Interaction Method**
3. **Cohort Retention: Slash Users vs Direct Users**
4. **Pie Chart: Command Discovery Sources**

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
- **Command Classification:** Based on slash_command_executed event
