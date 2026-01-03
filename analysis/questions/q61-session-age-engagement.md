# Session Age and User Engagement

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How does user engagement change over their session lifecycle? Compare new sessions (first 5 minutes) vs mid-session (5-30 min) vs long sessions (30+ min) in terms of feature usage, AI interaction density, and task completion. Identify engagement drop-off points within sessions.

---

## 2. Queries Used

### Query 1: Session Duration Distribution
```sql
-- Histogram of session lengths
-- Buckets: <5min, 5-15min, 15-30min, 30-60min, 60+ min
```

### Query 2: Feature Usage by Session Age
```sql
-- Track event types at different session timestamps
-- Compare first 5 min vs 10-20 min vs 30+ min
```

### Query 3: AI Interaction Density Over Session
```sql
-- AI messages per 5-minute bucket within sessions
-- Identify engagement curve shape
```

### Query 4: Session Abandonment Points
```sql
-- Identify common session end timestamps
-- Detect drop-off patterns (e.g., spike at 10 min mark)
```

### Query 5: Task Completion by Session Length
```sql
-- Correlate file saves, commits with session duration
-- Identify minimum productive session length
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Line Chart: Engagement Rate by Session Minute**
2. **Histogram: Session Duration Distribution**
3. **Heatmap: Feature Usage by Session Age**
4. **Survival Curve: Session Duration**

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
- **Session Tracking:** Based on session_started, session_ended events
