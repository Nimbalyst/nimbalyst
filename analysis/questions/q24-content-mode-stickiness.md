# Q24: Content Mode Stickiness - Files vs Agent Mode

## Question
How do users switch between Files mode and Agent mode, and what are the session return patterns for each mode?

## Hypothesis
Users develop preferences for specific modes based on their workflow, with some being primarily file-focused and others agent-focused, while a subset switches regularly.

## Key Metrics
- Daily usage split between Files and Agent mode
- Mode switching frequency within sessions and across sessions
- Retention rates by primary mode preference
- Time spent in each mode per session

## PostHog Analysis

### Query 1: Mode Usage Distribution
```hogql
SELECT
  mode_preference,
  COUNT(DISTINCT person_id) as user_count,
  (COUNT(DISTINCT person_id) * 100.0 / SUM(COUNT(DISTINCT person_id)) OVER ()) as percentage,
  AVG(files_sessions) as avg_files_sessions,
  AVG(agent_sessions) as avg_agent_sessions
FROM (
  SELECT
    person_id,
    COUNT(DISTINCT CASE WHEN mode = 'files' THEN session_id END) as files_sessions,
    COUNT(DISTINCT CASE WHEN mode = 'agent' THEN session_id END) as agent_sessions,
    CASE
      WHEN COUNT(DISTINCT CASE WHEN mode = 'files' THEN session_id END) > 0
        AND COUNT(DISTINCT CASE WHEN mode = 'agent' THEN session_id END) = 0
      THEN 'files_only'
      WHEN COUNT(DISTINCT CASE WHEN mode = 'agent' THEN session_id END) > 0
        AND COUNT(DISTINCT CASE WHEN mode = 'files' THEN session_id END) = 0
      THEN 'agent_only'
      WHEN COUNT(DISTINCT CASE WHEN mode = 'files' THEN session_id END) >
           COUNT(DISTINCT CASE WHEN mode = 'agent' THEN session_id END) * 2
      THEN 'files_primary'
      WHEN COUNT(DISTINCT CASE WHEN mode = 'agent' THEN session_id END) >
           COUNT(DISTINCT CASE WHEN mode = 'files' THEN session_id END) * 2
      THEN 'agent_primary'
      ELSE 'balanced_switcher'
    END as mode_preference
  FROM (
    SELECT
      person_id,
      properties.$session_id as session_id,
      properties.contentMode as mode
    FROM events
    WHERE
      event IN ('content_mode_switched', 'file_opened', 'ai_message_sent')
      AND timestamp >= now() - INTERVAL 30 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
      AND properties.contentMode IN ('files', 'agent')
  )
  GROUP BY person_id
)
GROUP BY mode_preference
ORDER BY user_count DESC
```

### Query 2: Mode Switching Patterns
```hogql
SELECT
  toDate(timestamp) as date,
  COUNT(*) as total_mode_switches,
  COUNT(DISTINCT person_id) as unique_switchers,
  COUNT(DISTINCT properties.$session_id) as sessions_with_switches,
  COUNT(*) / COUNT(DISTINCT person_id) as avg_switches_per_user
FROM events
WHERE
  event = 'content_mode_switched'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.is_dev_user != true
  AND NOT has(['all_filtered_cohorts'], cohort)
GROUP BY date
ORDER BY date DESC
LIMIT 30
```

### Query 3: Session Duration by Mode
```hogql
SELECT
  mode,
  quantile(0.5)(session_duration_minutes) as median_duration_minutes,
  quantile(0.75)(session_duration_minutes) as p75_duration_minutes,
  AVG(session_duration_minutes) as avg_duration_minutes,
  COUNT(*) as session_count
FROM (
  SELECT
    properties.$session_id as session_id,
    properties.contentMode as mode,
    dateDiff('minute', MIN(timestamp), MAX(timestamp)) as session_duration_minutes
  FROM events
  WHERE
    timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND properties.contentMode IN ('files', 'agent')
    AND properties.$session_id IS NOT NULL
  GROUP BY session_id, mode
  HAVING session_duration_minutes > 0 AND session_duration_minutes < 480  -- exclude outliers > 8 hours
)
GROUP BY mode
ORDER BY mode
```

### Query 4: Retention by Mode Preference
```hogql
SELECT
  mode_preference,
  COUNT(DISTINCT person_id) as cohort_size,
  COUNT(DISTINCT CASE WHEN retained_7_day THEN person_id END) as retained_7,
  COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) as retained_30,
  (COUNT(DISTINCT CASE WHEN retained_7_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_7_day,
  (COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_30_day
FROM (
  SELECT
    person_id,
    first_seen,
    mode_preference,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 7 DAY
        AND timestamp < first_seen + INTERVAL 14 DAY
      THEN 1 ELSE 0
    END) as retained_7_day,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 30 DAY
        AND timestamp < first_seen + INTERVAL 37 DAY
      THEN 1 ELSE 0
    END) as retained_30_day
  FROM events
  JOIN (
    SELECT
      person_id,
      MIN(timestamp) as first_seen
    FROM events
    WHERE
      timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as user_cohort USING (person_id)
  JOIN (
    SELECT
      person_id,
      CASE
        WHEN files_usage > 0 AND agent_usage = 0 THEN 'files_only'
        WHEN agent_usage > 0 AND files_usage = 0 THEN 'agent_only'
        WHEN files_usage > agent_usage * 2 THEN 'files_primary'
        WHEN agent_usage > files_usage * 2 THEN 'agent_primary'
        ELSE 'balanced'
      END as mode_preference
    FROM (
      SELECT
        person_id,
        COUNT(CASE WHEN properties.contentMode = 'files' THEN 1 END) as files_usage,
        COUNT(CASE WHEN properties.contentMode = 'agent' THEN 1 END) as agent_usage
      FROM events
      WHERE
        timestamp >= now() - INTERVAL 90 DAY
        AND properties.is_dev_user != true
        AND NOT has(['all_filtered_cohorts'], cohort)
        AND properties.contentMode IN ('files', 'agent')
      GROUP BY person_id
    )
  ) as mode_prefs USING (person_id)
  WHERE
    timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id, first_seen, mode_preference
)
WHERE first_seen <= now() - INTERVAL 30 DAY
GROUP BY mode_preference
ORDER BY cohort_size DESC
```

### Query 5: Cross-Mode Activity Patterns
```hogql
SELECT
  hour_of_day,
  mode,
  COUNT(*) as activity_count,
  COUNT(DISTINCT person_id) as unique_users
FROM (
  SELECT
    person_id,
    toHour(timestamp) as hour_of_day,
    properties.contentMode as mode
  FROM events
  WHERE
    event IN ('file_opened', 'ai_message_sent', 'content_mode_switched')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND properties.contentMode IN ('files', 'agent')
)
GROUP BY hour_of_day, mode
ORDER BY hour_of_day, mode
```

## Expected Insights
- Distribution of users by mode preference (files-only, agent-only, balanced)
- Frequency and patterns of mode switching
- Session duration differences between modes
- Retention correlation with mode preference
- Time-of-day patterns for each mode

## Follow-up Questions
- What triggers mode switches - specific tasks or user workflows?
- Do mode switchers have higher engagement than single-mode users?
- Are there specific features that predict mode preference?
