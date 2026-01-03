# Collaboration Session Frequency and Patterns

**Analysis Date:** TBD
**Time Period:** Last 90 days
**Data Filters:** Excluded dev users (`is_dev_user != true`), excluded `all_filtered_cohorts` cohort, and test accounts

---

## 1. Research Question

How frequently do users collaborate via shared sessions? Analyze collaboration session frequency, duration, participant count, and collaborative editing patterns. Identify team vs individual user behavior and whether collaboration features drive retention.

---

## 2. Queries Used

### Query 1: Collaboration Session Frequency
```sql
-- Track collab_session_started events
-- Count sessions per user and per workspace
```

### Query 2: Collaboration Participant Patterns
```sql
-- Track collab_participant_joined events
-- Measure session size (2-person, 3-5, 5+ participants)
```

### Query 3: Collaborative Editing Metrics
```sql
-- Track concurrent_edit_detected events
-- Measure real-time collaboration intensity
```

### Query 4: Collaboration → Retention
```sql
-- Compare retention for users who collaborate vs solo users
```

### Query 5: Collaboration Tool Usage
```sql
-- Track collab-specific features: cursors, presence, chat
-- Usage frequency during sessions
```

---

## 3. Raw Results

[Results pending]

---

## 4. Visualizations

### Recommended Charts

1. **Histogram: Collaboration Sessions per User**
2. **Pie Chart: Session Size Distribution**
3. **Time Series: Collaboration Sessions Over Time**
4. **Cohort Retention: Collaborators vs Solo Users**

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
- **Collaboration Events:** Based on collab_session events
