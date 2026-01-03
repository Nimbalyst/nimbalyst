# Q25: Slash Command Engagement and Message Length

## Question
How does slash command count correlate with AI message length and overall engagement?

## Hypothesis
Users who leverage slash commands may write more efficient (shorter) messages while maintaining or increasing overall AI engagement, suggesting slash commands improve workflow efficiency.

## Key Metrics
- Average message length by slash command usage frequency
- Slash command diversity vs total AI messages sent
- Session length correlation with slash command usage
- Most efficient slash commands (measured by subsequent message brevity)

## PostHog Analysis

### Query 1: Message Length by Slash Command Usage
```hogql
SELECT
  slash_command_tier,
  COUNT(DISTINCT person_id) as user_count,
  AVG(avg_message_length) as avg_chars_per_message,
  AVG(total_messages) as avg_total_messages,
  AVG(slash_commands_used) as avg_slash_commands
FROM (
  SELECT
    person_id,
    CASE
      WHEN slash_commands_used = 0 THEN '0 slash commands'
      WHEN slash_commands_used < 5 THEN '1-4 slash commands'
      WHEN slash_commands_used < 10 THEN '5-9 slash commands'
      WHEN slash_commands_used < 20 THEN '10-19 slash commands'
      ELSE '20+ slash commands'
    END as slash_command_tier,
    AVG(CASE WHEN message_length > 0 THEN message_length END) as avg_message_length,
    COUNT(CASE WHEN event = 'ai_message_sent' THEN 1 END) as total_messages,
    COUNT(CASE WHEN event = 'slash_command_used' THEN 1 END) as slash_commands_used
  FROM (
    SELECT
      person_id,
      event,
      CASE
        WHEN event = 'ai_message_sent' THEN length(toString(properties.message))
        ELSE 0
      END as message_length
    FROM events
    WHERE
      event IN ('ai_message_sent', 'slash_command_used')
      AND timestamp >= now() - INTERVAL 30 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
  )
  GROUP BY person_id
)
GROUP BY slash_command_tier
ORDER BY
  CASE slash_command_tier
    WHEN '0 slash commands' THEN 0
    WHEN '1-4 slash commands' THEN 1
    WHEN '5-9 slash commands' THEN 2
    WHEN '10-19 slash commands' THEN 3
    ELSE 4
  END
```

### Query 2: Slash Command Diversity and Engagement
```hogql
SELECT
  unique_commands_bucket,
  COUNT(DISTINCT person_id) as user_count,
  AVG(total_ai_messages) as avg_messages,
  AVG(total_sessions) as avg_sessions,
  AVG(total_ai_messages / NULLIF(total_sessions, 0)) as avg_messages_per_session
FROM (
  SELECT
    person_id,
    CASE
      WHEN unique_commands = 0 THEN '0 commands'
      WHEN unique_commands = 1 THEN '1 command'
      WHEN unique_commands < 4 THEN '2-3 commands'
      WHEN unique_commands < 6 THEN '4-5 commands'
      ELSE '6+ commands'
    END as unique_commands_bucket,
    total_ai_messages,
    total_sessions
  FROM (
    SELECT
      person_id,
      COUNT(DISTINCT CASE WHEN event = 'slash_command_used' THEN properties.command END) as unique_commands,
      COUNT(CASE WHEN event = 'ai_message_sent' THEN 1 END) as total_ai_messages,
      COUNT(DISTINCT CASE WHEN event = 'ai_message_sent' THEN properties.$session_id END) as total_sessions
    FROM events
    WHERE
      event IN ('ai_message_sent', 'slash_command_used')
      AND timestamp >= now() - INTERVAL 30 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  )
)
GROUP BY unique_commands_bucket
ORDER BY
  CASE unique_commands_bucket
    WHEN '0 commands' THEN 0
    WHEN '1 command' THEN 1
    WHEN '2-3 commands' THEN 2
    WHEN '4-5 commands' THEN 3
    ELSE 4
  END
```

### Query 3: Command-Specific Efficiency Analysis
```hogql
SELECT
  properties.command as slash_command,
  COUNT(*) as command_usage_count,
  COUNT(DISTINCT person_id) as unique_users,
  AVG(subsequent_message_length) as avg_next_message_length,
  quantile(0.5)(subsequent_message_length) as median_next_message_length
FROM events as cmd_event
LEFT JOIN LATERAL (
  SELECT length(toString(properties.message)) as subsequent_message_length
  FROM events as msg_event
  WHERE
    msg_event.person_id = cmd_event.person_id
    AND msg_event.event = 'ai_message_sent'
    AND msg_event.timestamp > cmd_event.timestamp
    AND msg_event.timestamp <= cmd_event.timestamp + INTERVAL 5 MINUTE
    AND msg_event.properties.$session_id = cmd_event.properties.$session_id
  ORDER BY msg_event.timestamp ASC
  LIMIT 1
) as next_message ON true
WHERE
  cmd_event.event = 'slash_command_used'
  AND cmd_event.timestamp >= now() - INTERVAL 30 DAY
  AND cmd_event.properties.is_dev_user != true
  AND NOT has(['all_filtered_cohorts'], cmd_event.cohort)
GROUP BY slash_command
HAVING command_usage_count >= 10
ORDER BY command_usage_count DESC
LIMIT 20
```

### Query 4: Session Efficiency by Slash Command Usage
```hogql
SELECT
  uses_slash_commands,
  COUNT(DISTINCT session_id) as session_count,
  AVG(session_duration_minutes) as avg_session_duration,
  AVG(messages_per_session) as avg_messages,
  AVG(session_duration_minutes / NULLIF(messages_per_session, 0)) as avg_minutes_per_message
FROM (
  SELECT
    properties.$session_id as session_id,
    MAX(CASE WHEN event = 'slash_command_used' THEN 1 ELSE 0 END) as uses_slash_commands,
    dateDiff('minute', MIN(timestamp), MAX(timestamp)) as session_duration_minutes,
    COUNT(CASE WHEN event = 'ai_message_sent' THEN 1 END) as messages_per_session
  FROM events
  WHERE
    event IN ('ai_message_sent', 'slash_command_used')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND properties.$session_id IS NOT NULL
  GROUP BY session_id
  HAVING messages_per_session > 0 AND session_duration_minutes > 0 AND session_duration_minutes < 240
)
GROUP BY uses_slash_commands
ORDER BY uses_slash_commands DESC
```

### Query 5: Slash Command Adoption and Retention
```hogql
SELECT
  adopted_slash_commands,
  COUNT(DISTINCT person_id) as cohort_size,
  COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) as retained_30,
  (COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_30_day,
  AVG(days_to_adoption) as avg_days_to_slash_adoption
FROM (
  SELECT
    person_id,
    first_seen,
    CASE WHEN first_slash_command IS NOT NULL THEN 1 ELSE 0 END as adopted_slash_commands,
    dateDiff('day', first_seen, first_slash_command) as days_to_adoption,
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
  LEFT JOIN (
    SELECT
      person_id,
      MIN(timestamp) as first_slash_command
    FROM events
    WHERE
      event = 'slash_command_used'
      AND timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as slash_adoption USING (person_id)
  WHERE
    timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id, first_seen, first_slash_command
)
WHERE first_seen <= now() - INTERVAL 30 DAY
GROUP BY adopted_slash_commands
ORDER BY adopted_slash_commands DESC
```

## Expected Insights
- Correlation between slash command usage and message length
- Whether command diversity increases overall engagement
- Which specific slash commands lead to more efficient messaging
- Impact of slash command adoption on session productivity
- Retention differences between slash command users and non-users

## Follow-up Questions
- Do specific slash commands predict power user behavior?
- What is the optimal number of slash commands for user engagement?
- Are there underutilized slash commands that should be promoted?
