# Q18: Error Recovery and User Persistence

## Question
When users encounter file_save_failed or file_conflict_detected errors, what are their return rates and recovery behaviors?

## Hypothesis
Users who encounter save failures or conflicts may abandon the application unless they successfully recover, but successful recovery may indicate resilient power users.

## Key Metrics
- Users encountering save errors vs file conflicts
- Return rate after encountering errors (same session, same day, 7-day)
- Error resolution success rate (subsequent successful saves)
- Correlation between error recovery and long-term retention

## PostHog Analysis

### Query 1: Error Occurrence and User Return Rates
```hogql
SELECT
  error_type,
  COUNT(DISTINCT person_id) as users_with_error,
  COUNT(DISTINCT CASE WHEN returned_same_session THEN person_id END) as returned_same_session,
  COUNT(DISTINCT CASE WHEN returned_same_day THEN person_id END) as returned_same_day,
  COUNT(DISTINCT CASE WHEN returned_7_day THEN person_id END) as returned_7_day,
  (COUNT(DISTINCT CASE WHEN returned_same_session THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as same_session_rate,
  (COUNT(DISTINCT CASE WHEN returned_same_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as same_day_rate,
  (COUNT(DISTINCT CASE WHEN returned_7_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as seven_day_rate
FROM (
  SELECT
    person_id,
    error_event.event as error_type,
    error_event.timestamp as error_time,
    error_event.properties.$session_id as error_session_id,
    MAX(CASE
      WHEN future_event.timestamp > error_event.timestamp
        AND future_event.properties.$session_id = error_event.properties.$session_id
      THEN 1 ELSE 0
    END) as returned_same_session,
    MAX(CASE
      WHEN future_event.timestamp > error_event.timestamp
        AND toDate(future_event.timestamp) = toDate(error_event.timestamp)
      THEN 1 ELSE 0
    END) as returned_same_day,
    MAX(CASE
      WHEN future_event.timestamp > error_event.timestamp
        AND future_event.timestamp <= error_event.timestamp + INTERVAL 7 DAY
      THEN 1 ELSE 0
    END) as returned_7_day
  FROM events as error_event
  LEFT JOIN events as future_event ON
    error_event.person_id = future_event.person_id
    AND future_event.timestamp > error_event.timestamp
    AND future_event.timestamp <= error_event.timestamp + INTERVAL 7 DAY
    AND future_event.event IN ('file_opened', 'file_saved', 'ai_message_sent')
  WHERE
    error_event.event IN ('file_save_failed', 'file_conflict_detected')
    AND error_event.timestamp >= now() - INTERVAL 30 DAY
    AND error_event.properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], error_event.cohort)
  GROUP BY person_id, error_type, error_time, error_session_id
)
GROUP BY error_type
```

### Query 2: Error Recovery Success Rate
```hogql
SELECT
  error_type,
  COUNT(*) as total_errors,
  COUNT(CASE WHEN had_successful_save THEN 1 END) as recovered_errors,
  (COUNT(CASE WHEN had_successful_save THEN 1 END) * 100.0 / COUNT(*)) as recovery_rate,
  quantile(0.5)(CASE WHEN had_successful_save THEN recovery_time_minutes END) as median_recovery_minutes
FROM (
  SELECT
    person_id,
    error_event.event as error_type,
    error_event.timestamp as error_time,
    error_event.properties.filePath as error_file,
    MAX(CASE
      WHEN save_event.event = 'file_saved'
        AND save_event.timestamp > error_event.timestamp
        AND save_event.timestamp <= error_event.timestamp + INTERVAL 1 HOUR
        AND save_event.properties.filePath = error_event.properties.filePath
      THEN 1 ELSE 0
    END) as had_successful_save,
    MIN(CASE
      WHEN save_event.event = 'file_saved'
        AND save_event.timestamp > error_event.timestamp
        AND save_event.properties.filePath = error_event.properties.filePath
      THEN dateDiff('minute', error_event.timestamp, save_event.timestamp)
    END) as recovery_time_minutes
  FROM events as error_event
  LEFT JOIN events as save_event ON
    error_event.person_id = save_event.person_id
    AND save_event.timestamp > error_event.timestamp
    AND save_event.timestamp <= error_event.timestamp + INTERVAL 1 HOUR
  WHERE
    error_event.event IN ('file_save_failed', 'file_conflict_detected')
    AND error_event.timestamp >= now() - INTERVAL 30 DAY
    AND error_event.properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], error_event.cohort)
  GROUP BY person_id, error_type, error_time, error_file
)
GROUP BY error_type
```

### Query 3: Long-term Retention After Errors
```hogql
SELECT
  had_error,
  COUNT(DISTINCT person_id) as total_users,
  COUNT(DISTINCT CASE WHEN active_7_day THEN person_id END) as active_7_day,
  COUNT(DISTINCT CASE WHEN active_30_day THEN person_id END) as active_30_day,
  (COUNT(DISTINCT CASE WHEN active_7_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_7_day,
  (COUNT(DISTINCT CASE WHEN active_30_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_30_day
FROM (
  SELECT
    person_id,
    MIN(first_seen) as user_start,
    MAX(CASE WHEN event IN ('file_save_failed', 'file_conflict_detected') THEN 1 ELSE 0 END) as had_error,
    MAX(CASE
      WHEN timestamp >= MIN(first_seen) + INTERVAL 7 DAY
        AND timestamp <= MIN(first_seen) + INTERVAL 14 DAY
      THEN 1 ELSE 0
    END) as active_7_day,
    MAX(CASE
      WHEN timestamp >= MIN(first_seen) + INTERVAL 30 DAY
        AND timestamp <= MIN(first_seen) + INTERVAL 37 DAY
      THEN 1 ELSE 0
    END) as active_30_day
  FROM events
  JOIN (
    SELECT person_id, MIN(timestamp) as first_seen
    FROM events
    WHERE timestamp >= now() - INTERVAL 60 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as user_starts USING (person_id)
  WHERE
    timestamp >= now() - INTERVAL 60 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
)
WHERE user_start <= now() - INTERVAL 30 DAY
GROUP BY had_error
```

### Query 4: Error Context Analysis
```hogql
SELECT
  error_type,
  properties.errorCode as error_code,
  properties.conflictType as conflict_type,
  COUNT(*) as occurrence_count,
  COUNT(DISTINCT person_id) as affected_users,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY error_type)) as pct_of_error_type
FROM events
WHERE
  event IN ('file_save_failed', 'file_conflict_detected')
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.is_dev_user != true
  AND NOT has(['all_filtered_cohorts'], cohort)
GROUP BY error_type, error_code, conflict_type
ORDER BY error_type, occurrence_count DESC
```

## Expected Insights
- Return and recovery rates for different error types
- Time to successful recovery after errors
- Impact of errors on long-term user retention
- Most common error scenarios and their resolution patterns

## Follow-up Questions
- Do users who successfully recover from errors become more engaged?
- Are there specific error codes that cause higher abandonment?
- What user actions immediately before errors correlate with successful recovery?
