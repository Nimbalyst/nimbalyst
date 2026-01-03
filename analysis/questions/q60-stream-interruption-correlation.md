# AI Stream Interruption and Error Correlation

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

What causes AI streaming interruptions, and how do they correlate with user frustration or churn? Analyze ai_stream_error events, network issues, provider timeouts, and user abandonment after interruptions. Identify error patterns and recovery mechanisms.

---

## 2. Queries Used

### Query 1: Stream Interruption Frequency
```sql
-- Track ai_stream_error, ai_stream_interrupted events
-- Count by provider, error type, and time period
```

### Query 2: Interruption Triggers
```sql
-- Classify interruption causes: network, timeout, rate limit, server error
-- Distribution of error types
```

### Query 3: User Abandonment After Interruption
```sql
-- Measure session continuation rate after ai_stream_error
-- Compare to normal session abandonment rate
```

### Query 4: Retry Behavior
```sql
-- Track ai_message_retry events after interruptions
-- Success rate of retries
```

### Query 5: Interruption Impact on Retention
```sql
-- Cohort analysis: users with >3 interruptions vs <3
-- Compare 7-day and 30-day retention
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Pie Chart: Interruption Causes**
2. **Time Series: Interruptions Over Time by Provider**
3. **Funnel: Interruption → Retry → Success/Abandon**
4. **Cohort Retention: High vs Low Interruption Users**

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
- **Error Events:** Based on ai_stream_error, ai_stream_interrupted
