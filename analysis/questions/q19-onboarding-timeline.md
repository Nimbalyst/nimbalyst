# Q19: Onboarding Timeline and AI Adoption

## Question
What is the typical timeline from first use to feature_walkthrough_completed, and how does this correlate with AI feature adoption?

## Hypothesis
Users who complete the feature walkthrough faster have higher AI adoption rates, suggesting effective onboarding drives engagement.

## Key Metrics
- Time to complete feature walkthrough (median, p75, p95)
- Walkthrough completion rate by cohort
- AI adoption rate (first ai_message_sent) for walkthrough completers vs non-completers
- Time from walkthrough to first AI usage

## PostHog Analysis

### Query 1: Feature Walkthrough Completion Timeline
```hogql
SELECT
  CASE
    WHEN days_to_complete < 1 THEN 'Same day'
    WHEN days_to_complete < 7 THEN '1-7 days'
    WHEN days_to_complete < 30 THEN '7-30 days'
    ELSE '30+ days'
  END as completion_timeline,
  COUNT(*) as user_count,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()) as percentage,
  AVG(days_to_complete) as avg_days
FROM (
  SELECT
    person_id,
    dateDiff('day', first_seen, walkthrough_completed) as days_to_complete
  FROM (
    SELECT
      person_id,
      MIN(CASE WHEN event != 'feature_walkthrough_completed' THEN timestamp END) as first_seen,
      MIN(CASE WHEN event = 'feature_walkthrough_completed' THEN timestamp END) as walkthrough_completed
    FROM events
    WHERE
      timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
    HAVING walkthrough_completed IS NOT NULL AND first_seen IS NOT NULL
  )
)
GROUP BY completion_timeline
ORDER BY
  CASE completion_timeline
    WHEN 'Same day' THEN 1
    WHEN '1-7 days' THEN 2
    WHEN '7-30 days' THEN 3
    ELSE 4
  END
```

### Query 2: Walkthrough Completion vs AI Adoption
```hogql
SELECT
  completed_walkthrough,
  COUNT(DISTINCT person_id) as total_users,
  COUNT(DISTINCT CASE WHEN used_ai THEN person_id END) as ai_users,
  (COUNT(DISTINCT CASE WHEN used_ai THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as ai_adoption_rate,
  AVG(CASE WHEN used_ai THEN days_to_ai_usage END) as avg_days_to_ai
FROM (
  SELECT
    person_id,
    MAX(CASE WHEN event = 'feature_walkthrough_completed' THEN 1 ELSE 0 END) as completed_walkthrough,
    MAX(CASE WHEN event = 'ai_message_sent' THEN 1 ELSE 0 END) as used_ai,
    dateDiff('day',
      MIN(timestamp),
      MIN(CASE WHEN event = 'ai_message_sent' THEN timestamp END)
    ) as days_to_ai_usage
  FROM events
  WHERE
    timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
)
GROUP BY completed_walkthrough
ORDER BY completed_walkthrough DESC
```

### Query 3: Walkthrough Completion Impact on Retention
```hogql
SELECT
  completed_walkthrough,
  COUNT(DISTINCT person_id) as cohort_size,
  COUNT(DISTINCT CASE WHEN active_day_7 THEN person_id END) as retained_7_day,
  COUNT(DISTINCT CASE WHEN active_day_30 THEN person_id END) as retained_30_day,
  (COUNT(DISTINCT CASE WHEN active_day_7 THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_7_day,
  (COUNT(DISTINCT CASE WHEN active_day_30 THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_30_day
FROM (
  SELECT
    person_id,
    user_cohort.first_seen,
    MAX(CASE WHEN event = 'feature_walkthrough_completed' THEN 1 ELSE 0 END) as completed_walkthrough,
    MAX(CASE
      WHEN timestamp >= user_cohort.first_seen + INTERVAL 7 DAY
        AND timestamp < user_cohort.first_seen + INTERVAL 14 DAY
      THEN 1 ELSE 0
    END) as active_day_7,
    MAX(CASE
      WHEN timestamp >= user_cohort.first_seen + INTERVAL 30 DAY
        AND timestamp < user_cohort.first_seen + INTERVAL 37 DAY
      THEN 1 ELSE 0
    END) as active_day_30
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
  GROUP BY person_id, user_cohort.first_seen
)
WHERE first_seen <= now() - INTERVAL 30 DAY
GROUP BY completed_walkthrough
ORDER BY completed_walkthrough DESC
```

### Query 4: Feature Discovery Post-Walkthrough
```hogql
SELECT
  walkthrough_status,
  feature_event,
  COUNT(DISTINCT person_id) as users,
  AVG(days_from_start) as avg_days_to_feature
FROM (
  SELECT
    person_id,
    CASE
      WHEN completed_walkthrough_time IS NOT NULL THEN 'completed'
      ELSE 'not_completed'
    END as walkthrough_status,
    feature_event,
    dateDiff('day', first_seen, feature_time) as days_from_start
  FROM (
    SELECT
      person_id,
      MIN(CASE WHEN event != 'feature_walkthrough_completed' THEN timestamp END) as first_seen,
      MIN(CASE WHEN event = 'feature_walkthrough_completed' THEN timestamp END) as completed_walkthrough_time,
      event as feature_event,
      MIN(timestamp) as feature_time
    FROM events
    WHERE
      event IN (
        'git_operation_completed',
        'mcp_server_connected',
        'slash_command_used',
        'ai_message_sent',
        'mockup_file_opened',
        'file_shared'
      )
      AND timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id, feature_event
  )
  WHERE first_seen IS NOT NULL
)
GROUP BY walkthrough_status, feature_event
ORDER BY walkthrough_status, avg_days_to_feature
```

## Expected Insights
- Distribution of time to walkthrough completion
- Correlation between walkthrough completion and AI adoption
- Impact of walkthrough on retention rates
- Feature discovery patterns for walkthrough completers vs non-completers

## Follow-up Questions
- Which walkthrough steps correlate most strongly with retention?
- Do users who skip the walkthrough eventually discover features organically?
- What is the optimal timing to prompt walkthrough completion?
