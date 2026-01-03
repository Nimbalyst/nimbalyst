# Q20: Cross-Feature Journeys - Git Worktree Users

## Question
How do users who use git-worktree filtering differ from standard users in their AI usage patterns and overall engagement?

## Hypothesis
Git worktree users represent advanced developers who may have different AI assistance needs and engagement patterns compared to standard users.

## Key Metrics
- DAU/MAU ratio for worktree users vs standard users
- AI message frequency and session length comparison
- Feature adoption breadth (MCP, slash commands, git operations)
- Retention rates by user type

## PostHog Analysis

### Query 1: Git Worktree User Identification and Activity
```hogql
SELECT
  user_type,
  COUNT(DISTINCT person_id) as unique_users,
  COUNT(DISTINCT toDate(timestamp)) / COUNT(DISTINCT person_id) as avg_active_days,
  COUNT(*) / COUNT(DISTINCT person_id) as avg_events_per_user
FROM (
  SELECT
    person_id,
    timestamp,
    CASE
      WHEN person_id IN (
        SELECT DISTINCT person_id
        FROM events
        WHERE event = 'git_worktree_filter_applied'
          AND timestamp >= now() - INTERVAL 30 DAY
      ) THEN 'worktree_user'
      ELSE 'standard_user'
    END as user_type
  FROM events
  WHERE
    timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
GROUP BY user_type
```

### Query 2: AI Usage Patterns by User Type
```hogql
SELECT
  user_type,
  COUNT(DISTINCT person_id) as users_with_ai,
  COUNT(DISTINCT CASE WHEN event = 'ai_message_sent' THEN properties.$session_id END) / COUNT(DISTINCT person_id) as avg_ai_sessions_per_user,
  AVG(CASE WHEN event = 'ai_session_resumed' THEN toInt64(properties.messageCount) END) as avg_messages_per_session,
  COUNT(CASE WHEN event = 'ai_message_sent' THEN 1 END) / COUNT(DISTINCT person_id) as avg_ai_messages_per_user
FROM (
  SELECT
    person_id,
    event,
    properties,
    CASE
      WHEN person_id IN (
        SELECT DISTINCT person_id
        FROM events
        WHERE event = 'git_worktree_filter_applied'
          AND timestamp >= now() - INTERVAL 30 DAY
      ) THEN 'worktree_user'
      ELSE 'standard_user'
    END as user_type
  FROM events
  WHERE
    event IN ('ai_message_sent', 'ai_session_resumed')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
GROUP BY user_type
```

### Query 3: Feature Adoption Breadth
```hogql
SELECT
  user_type,
  feature_category,
  COUNT(DISTINCT person_id) as users,
  (COUNT(DISTINCT person_id) * 100.0 / MAX(total_users) OVER (PARTITION BY user_type)) as adoption_rate
FROM (
  SELECT
    person_id,
    CASE
      WHEN event IN ('mcp_server_connected', 'mcp_tool_called') THEN 'mcp'
      WHEN event LIKE 'slash_command_%' THEN 'slash_commands'
      WHEN event LIKE 'git_%' THEN 'git_operations'
      WHEN event IN ('ai_message_sent', 'ai_session_resumed') THEN 'ai_features'
      WHEN event LIKE 'mockup_%' THEN 'mockup_editor'
      WHEN event LIKE 'file_shared%' THEN 'collaboration'
      ELSE 'other'
    END as feature_category,
    CASE
      WHEN person_id IN (
        SELECT DISTINCT person_id
        FROM events
        WHERE event = 'git_worktree_filter_applied'
          AND timestamp >= now() - INTERVAL 30 DAY
      ) THEN 'worktree_user'
      ELSE 'standard_user'
    END as user_type
  FROM events
  WHERE
    timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
JOIN (
  SELECT
    CASE
      WHEN person_id IN (
        SELECT DISTINCT person_id
        FROM events
        WHERE event = 'git_worktree_filter_applied'
          AND timestamp >= now() - INTERVAL 30 DAY
      ) THEN 'worktree_user'
      ELSE 'standard_user'
    END as user_type,
    COUNT(DISTINCT person_id) as total_users
  FROM events
  WHERE
    timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY user_type
) as totals USING (user_type)
WHERE feature_category != 'other'
GROUP BY user_type, feature_category
ORDER BY user_type, adoption_rate DESC
```

### Query 4: Retention Comparison
```hogql
SELECT
  user_type,
  COUNT(DISTINCT person_id) as cohort_size,
  COUNT(DISTINCT CASE WHEN week_1_active THEN person_id END) as retained_week_1,
  COUNT(DISTINCT CASE WHEN week_2_active THEN person_id END) as retained_week_2,
  COUNT(DISTINCT CASE WHEN week_4_active THEN person_id END) as retained_week_4,
  (COUNT(DISTINCT CASE WHEN week_1_active THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_week_1,
  (COUNT(DISTINCT CASE WHEN week_2_active THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_week_2,
  (COUNT(DISTINCT CASE WHEN week_4_active THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_week_4
FROM (
  SELECT
    person_id,
    first_seen,
    CASE
      WHEN person_id IN (
        SELECT DISTINCT person_id
        FROM events
        WHERE event = 'git_worktree_filter_applied'
          AND timestamp >= now() - INTERVAL 60 DAY
      ) THEN 'worktree_user'
      ELSE 'standard_user'
    END as user_type,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 7 DAY
        AND timestamp < first_seen + INTERVAL 14 DAY
      THEN 1 ELSE 0
    END) as week_1_active,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 14 DAY
        AND timestamp < first_seen + INTERVAL 21 DAY
      THEN 1 ELSE 0
    END) as week_2_active,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 28 DAY
        AND timestamp < first_seen + INTERVAL 35 DAY
      THEN 1 ELSE 0
    END) as week_4_active
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
  WHERE
    timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id, first_seen
)
WHERE first_seen <= now() - INTERVAL 28 DAY
GROUP BY user_type
ORDER BY user_type
```

## Expected Insights
- Activity levels and engagement differences between worktree and standard users
- AI usage patterns specific to advanced git workflows
- Feature adoption breadth indicating power user behavior
- Retention differences suggesting product-market fit for different user segments

## Follow-up Questions
- Do worktree users have different AI prompt patterns or topics?
- What features do worktree users adopt earlier than standard users?
- Are there onboarding or documentation gaps for advanced git features?
