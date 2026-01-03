# File Type Workflow Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

What file types do users work with most frequently, and how do workflows differ across file types? Compare code files (.js, .py, .ts) vs markdown (.md) vs configuration files (.json, .yaml). Analyze editor type preference, AI interaction patterns, and session characteristics by file extension.

---

## 2. Queries Used

### Query 1: File Type Distribution
```sql
-- Count files opened/edited by extension
-- Group by file_extension property
```

### Query 2: Editor Choice by File Type
```sql
-- Monaco vs Lexical usage split by file extension
-- Track editor_opened events with file metadata
```

### Query 3: AI Usage by File Type
```sql
-- AI messages sent within sessions editing specific file types
-- Correlate ai_message_sent with active file context
```

### Query 4: Session Duration by File Type
```sql
-- Average session length when primary file type is code vs markdown vs config
```

### Query 5: Multi-File Editing Patterns
```sql
-- Users who mix file types in single session
-- Most common file type combinations
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Treemap: File Type Distribution by Edit Volume**
2. **Grouped Bar: Editor Choice (Monaco/Lexical) by File Type**
3. **Heatmap: AI Interaction Rate by File Type**
4. **Sankey: File Type Combination Flows**

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
- **File Type Extraction:** Based on file_extension or file_path properties
