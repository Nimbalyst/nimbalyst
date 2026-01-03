# Database Error Impact - Error Types and User Impact Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

What types of database errors occur most frequently and how do they impact users? Track error types (connection, query timeout, constraint violation), affected user segments, correlation with user churn or session abandonment, and whether errors cluster around specific features or times.

---

## 2. Queries Used

### Query 1: Database Error Frequency by Type
```sql
SELECT properties.error_type,
       properties.error_code,
       count(*) as error_count,
       count(DISTINCT person_id) as affected_users,
       count(DISTINCT properties.session_id) as affected_sessions,
       round(count(*) * 100.0 / sum(count(*)) OVER (), 2) as pct_of_total_errors
FROM events
WHERE event = 'database_error'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY properties.error_type, properties.error_code
ORDER BY error_count DESC
LIMIT 20
```

### Query 2: User Impact Segmentation
```sql
WITH error_users AS (
  SELECT person_id,
         count(*) as error_count,
         count(DISTINCT properties.error_type) as unique_error_types,
         min(timestamp) as first_error,
         max(timestamp) as last_error
  FROM events
  WHERE event = 'database_error'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
),
all_users AS (
  SELECT person_id,
         count(*) as total_events
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT
  CASE
    WHEN eu.error_count IS NULL THEN 'no_errors'
    WHEN eu.error_count = 1 THEN 'single_error'
    WHEN eu.error_count <= 5 THEN 'occasional_errors'
    WHEN eu.error_count <= 20 THEN 'frequent_errors'
    ELSE 'severe_errors'
  END as error_segment,
  count(*) as user_count,
  round(avg(COALESCE(eu.error_count, 0)), 1) as avg_errors,
  round(avg(au.total_events), 0) as avg_total_events
FROM all_users au
LEFT JOIN error_users eu ON au.person_id = eu.person_id
GROUP BY error_segment
ORDER BY user_count DESC
```

### Query 3: Session Abandonment After Errors
```sql
WITH error_sessions AS (
  SELECT properties.session_id,
         person_id,
         timestamp as error_time,
         properties.error_type
  FROM events
  WHERE event = 'database_error'
    AND timestamp >= now() - INTERVAL 90 DAY
),
session_activity AS (
  SELECT properties.session_id,
         person_id,
         max(timestamp) as last_activity
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
  GROUP BY properties.session_id, person_id
)
SELECT
  dateDiff('minute', es.error_time, sa.last_activity) as minutes_after_error,
  CASE
    WHEN dateDiff('minute', es.error_time, sa.last_activity) < 1 THEN 'abandoned_immediately'
    WHEN dateDiff('minute', es.error_time, sa.last_activity) < 5 THEN 'abandoned_within_5min'
    WHEN dateDiff('minute', es.error_time, sa.last_activity) < 30 THEN 'continued_briefly'
    ELSE 'continued_session'
  END as abandonment_pattern,
  count(*) as session_count,
  round(count(*) * 100.0 / (SELECT count(*) FROM error_sessions), 2) as pct_of_error_sessions
FROM error_sessions es
JOIN session_activity sa
  ON es.session_id = sa.session_id
  AND es.person_id = sa.person_id
GROUP BY abandonment_pattern
ORDER BY session_count DESC
```

### Query 4: Feature-Specific Error Clustering
```sql
SELECT properties.feature_area,
       properties.error_type,
       count(*) as error_count,
       count(DISTINCT person_id) as affected_users,
       round(count(*) * 100.0 / sum(count(*)) OVER (PARTITION BY properties.feature_area), 2) as pct_of_feature_errors
FROM events
WHERE event = 'database_error'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY properties.feature_area, properties.error_type
ORDER BY error_count DESC
LIMIT 20
```

### Query 5: Temporal Error Clustering
```sql
SELECT date(timestamp) as error_date,
       toHour(timestamp) as error_hour,
       count(*) as error_count,
       count(DISTINCT person_id) as affected_users,
       groupUniqArray(3)(properties.error_type) as top_error_types
FROM events
WHERE event = 'database_error'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY error_date, error_hour
HAVING error_count > 10 -- only show significant spikes
ORDER BY error_count DESC
LIMIT 20
```

### Query 6: User Churn Correlation
```sql
WITH error_users AS (
  SELECT person_id,
         count(*) as error_count,
         max(timestamp) as last_error
  FROM events
  WHERE event = 'database_error'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
),
user_activity AS (
  SELECT person_id,
         max(timestamp) as last_seen,
         count(DISTINCT date(timestamp)) as active_days
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT
  CASE
    WHEN eu.error_count IS NULL THEN 'no_errors'
    WHEN eu.error_count <= 5 THEN 'few_errors'
    ELSE 'many_errors'
  END as error_group,
  count(*) as total_users,
  countIf(dateDiff('day', ua.last_seen, now()) > 14) as churned_users,
  round(countIf(dateDiff('day', ua.last_seen, now()) > 14) * 100.0 / count(*), 2) as churn_rate,
  round(avg(ua.active_days), 1) as avg_active_days
FROM user_activity ua
LEFT JOIN error_users eu ON ua.person_id = eu.person_id
GROUP BY error_group
```

---

## 3. Raw Results

[Results to be populated via PostHog queries]

---

## 4. Visualizations

### Recommended Charts

1. **Horizontal Bar Chart: Error Types**
2. **Pie Chart: User Impact Segments**
3. **Funnel Chart: Session Abandonment After Errors**
4. **Heat Map: Errors by Feature and Type**
5. **Time Series: Error Spikes Over Time**

---

## 5. Takeaways

[To be completed after running queries]

---

## 6. Suggested Actions / Product Direction

[To be completed after analyzing results]

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `database_error` event
- **Churn Definition:** No activity for 14+ days
- **Session Abandonment:** Time from error to last session activity
