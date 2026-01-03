# AI Provider Performance Comparison

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do AI providers compare on performance metrics (latency, error rate, completion rate)? Analyze time to first token, total response time, stream interruptions, and error frequency across Claude, OpenAI, Claude Code, and LM Studio. Identify which providers users switch to after performance issues.

---

## 2. Queries Used

### Query 1: Provider Latency Distribution
```sql
-- Calculate ai_response_latency percentiles (p50, p75, p95, p99) by provider
-- Compare time to first token
```

### Query 2: Provider Error Rates
```sql
-- Track ai_error events by provider and error_type
-- Calculate error rate per 1000 messages
```

### Query 3: Stream Completion Rates
```sql
-- ai_stream_completed vs ai_stream_interrupted by provider
-- Success rate percentage
```

### Query 4: Provider Switching After Errors
```sql
-- Track provider changes within 10 minutes of ai_error events
-- Identify frustration-driven switching
```

### Query 5: User Satisfaction by Provider
```sql
-- Correlate provider with session duration and return rate
-- Proxy for satisfaction
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Box Plot: Response Latency by Provider**
2. **Bar Chart: Error Rate by Provider**
3. **Grouped Bar: Completion Rate by Provider**
4. **Sankey: Provider Switching After Errors**

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
- **Performance Metrics:** Based on ai_response_latency, ai_error events
