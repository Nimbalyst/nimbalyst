# Q16: Power User Feature Discovery

## Question
How do power users (ai_session_resumed with messageCount 10+) discover and adopt slash commands?

## Hypothesis
Users with longer AI sessions are more likely to discover and use slash commands, indicating deeper engagement with advanced features.

## Key Metrics
- Slash command usage rate among power users (messageCount 10+)
- Time to first slash command after session start
- Most common first slash commands
- Correlation between session length and slash command diversity

## PostHog Analysis

### Query 1: Power Users Who Use Slash Commands
```hogql
SELECT
  COUNT(DISTINCT person_id) as power_users,
  COUNT(DISTINCT CASE WHEN has_slash_command THEN person_id END) as slash_command_users,
  (COUNT(DISTINCT CASE WHEN has_slash_command THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as adoption_rate
FROM (
  SELECT
    person_id,
    MAX(CASE WHEN event = 'slash_command_used' THEN 1 ELSE 0 END) as has_slash_command
  FROM events
  WHERE
    event IN ('ai_session_resumed', 'slash_command_used')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
  HAVING SUM(CASE WHEN event = 'ai_session_resumed' AND toInt64(properties.messageCount) >= 10 THEN 1 ELSE 0 END) > 0
)
```

### Query 2: Time to First Slash Command
```hogql
SELECT
  quantile(0.5)(time_to_first_slash_minutes) as median_time_minutes,
  quantile(0.75)(time_to_first_slash_minutes) as p75_time_minutes,
  quantile(0.95)(time_to_first_slash_minutes) as p95_time_minutes
FROM (
  SELECT
    person_id,
    dateDiff('minute',
      MIN(CASE WHEN event = 'ai_session_resumed' THEN timestamp END),
      MIN(CASE WHEN event = 'slash_command_used' THEN timestamp END)
    ) as time_to_first_slash_minutes
  FROM events
  WHERE
    event IN ('ai_session_resumed', 'slash_command_used')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
  HAVING
    SUM(CASE WHEN event = 'ai_session_resumed' AND toInt64(properties.messageCount) >= 10 THEN 1 ELSE 0 END) > 0
    AND MIN(CASE WHEN event = 'slash_command_used' THEN timestamp END) IS NOT NULL
)
```

### Query 3: Most Common First Slash Commands
```hogql
SELECT
  properties.command as first_command,
  COUNT(*) as user_count,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()) as percentage
FROM (
  SELECT
    person_id,
    argMin(properties, timestamp) as properties
  FROM events
  WHERE
    event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND person_id IN (
      SELECT DISTINCT person_id
      FROM events
      WHERE event = 'ai_session_resumed'
        AND toInt64(properties.messageCount) >= 10
        AND timestamp >= now() - INTERVAL 30 DAY
    )
  GROUP BY person_id
)
GROUP BY first_command
ORDER BY user_count DESC
LIMIT 10
```

### Query 4: Session Length vs Slash Command Diversity
```hogql
SELECT
  CASE
    WHEN max_message_count < 10 THEN '< 10'
    WHEN max_message_count < 20 THEN '10-19'
    WHEN max_message_count < 50 THEN '20-49'
    ELSE '50+'
  END as session_length_bucket,
  AVG(unique_commands) as avg_unique_commands,
  COUNT(DISTINCT person_id) as user_count
FROM (
  SELECT
    person_id,
    MAX(CASE WHEN event = 'ai_session_resumed' THEN toInt64(properties.messageCount) ELSE 0 END) as max_message_count,
    COUNT(DISTINCT CASE WHEN event = 'slash_command_used' THEN properties.command END) as unique_commands
  FROM events
  WHERE
    event IN ('ai_session_resumed', 'slash_command_used')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
)
WHERE max_message_count >= 10
GROUP BY session_length_bucket
ORDER BY
  CASE session_length_bucket
    WHEN '< 10' THEN 1
    WHEN '10-19' THEN 2
    WHEN '20-49' THEN 3
    ELSE 4
  END
```

## Expected Insights
- What percentage of power users adopt slash commands
- How quickly power users discover slash commands
- Which slash commands are most commonly discovered first
- Whether longer sessions correlate with broader slash command exploration

## Follow-up Questions
- Do specific slash commands lead to longer sessions?
- Are there user journeys that predict slash command adoption?
- What documentation or UI elements correlate with slash command discovery?
