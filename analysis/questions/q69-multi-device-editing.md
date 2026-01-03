# Multi-Device Editing Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How do users work across multiple devices (desktop, mobile, tablet)? Analyze device switching frequency, sync success rates, and cross-device workflow patterns. Identify users who edit on mobile then continue on desktop, and whether multi-device users have higher engagement.

---

## 2. Queries Used

### Query 1: Multi-Device User Identification
```sql
-- Count distinct devices per user (via device_id or platform)
-- Classify as single-device vs multi-device users
```

### Query 2: Device Switching Patterns
```sql
-- Track session_started events across devices
-- Identify switch frequency and timing
```

### Query 3: Cross-Device Workflow Sequences
```sql
-- Analyze sessions that span devices (e.g., mobile → desktop)
-- Time between device switches
```

### Query 4: Sync Success Rates
```sql
-- Track sync_completed, sync_failed events
-- Calculate success rate by device type
```

### Query 5: Multi-Device Engagement
```sql
-- Compare engagement metrics for multi-device vs single-device users
-- Session frequency, duration, retention
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Pie Chart: Single vs Multi-Device Users**
2. **Sankey: Cross-Device Session Flows**
3. **Bar Chart: Sync Success Rate by Device Type**
4. **Cohort Retention: Multi-Device vs Single-Device**

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
- **Device Tracking:** Based on device_id, platform properties
