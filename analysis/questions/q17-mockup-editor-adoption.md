# Q17: Mockup Editor Adoption

## Question
What is the adoption funnel for mockup editor features - from file opens to edits to repeat usage?

## Hypothesis
Mockup file opens have a conversion rate to editing, and users who edit once are likely to return for repeat usage.

## Key Metrics
- Mockup file open rate (unique users)
- Open to edit conversion rate
- Repeat usage rate (users with 2+ mockup sessions)
- Time between first and second mockup usage

## PostHog Analysis

### Query 1: Mockup Editor Funnel
```hogql
SELECT
  COUNT(DISTINCT person_id) as users_opened_mockup,
  COUNT(DISTINCT CASE WHEN has_edit THEN person_id END) as users_edited_mockup,
  COUNT(DISTINCT CASE WHEN has_repeat THEN person_id END) as users_repeat_mockup,
  (COUNT(DISTINCT CASE WHEN has_edit THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as open_to_edit_rate,
  (COUNT(DISTINCT CASE WHEN has_repeat THEN person_id END) * 100.0 / COUNT(DISTINCT CASE WHEN has_edit THEN person_id END)) as edit_to_repeat_rate
FROM (
  SELECT
    person_id,
    MAX(CASE WHEN event IN ('mockup_file_opened', 'mockup_editor_interaction') THEN 1 ELSE 0 END) as has_any,
    MAX(CASE WHEN event = 'mockup_editor_interaction' THEN 1 ELSE 0 END) as has_edit,
    CASE WHEN COUNT(DISTINCT toDate(timestamp)) >= 2 THEN 1 ELSE 0 END as has_repeat
  FROM events
  WHERE
    event IN ('mockup_file_opened', 'mockup_editor_interaction')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
)
```

### Query 2: Time to First Edit After Open
```hogql
SELECT
  quantile(0.5)(seconds_to_edit) as median_seconds,
  quantile(0.75)(seconds_to_edit) as p75_seconds,
  quantile(0.95)(seconds_to_edit) as p95_seconds,
  COUNT(*) as user_count
FROM (
  SELECT
    person_id,
    dateDiff('second',
      MIN(CASE WHEN event = 'mockup_file_opened' THEN timestamp END),
      MIN(CASE WHEN event = 'mockup_editor_interaction' THEN timestamp END)
    ) as seconds_to_edit
  FROM events
  WHERE
    event IN ('mockup_file_opened', 'mockup_editor_interaction')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
  HAVING
    MIN(CASE WHEN event = 'mockup_file_opened' THEN timestamp END) IS NOT NULL
    AND MIN(CASE WHEN event = 'mockup_editor_interaction' THEN timestamp END) IS NOT NULL
    AND seconds_to_edit >= 0
    AND seconds_to_edit < 3600  -- within 1 hour
)
```

### Query 3: Repeat Usage Patterns
```hogql
SELECT
  CASE
    WHEN days_between_sessions < 1 THEN '< 1 day'
    WHEN days_between_sessions < 7 THEN '1-7 days'
    WHEN days_between_sessions < 30 THEN '7-30 days'
    ELSE '30+ days'
  END as time_to_return,
  COUNT(*) as user_count,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()) as percentage
FROM (
  SELECT
    person_id,
    dateDiff('day',
      MIN(first_session),
      MIN(second_session)
    ) as days_between_sessions
  FROM (
    SELECT
      person_id,
      toDate(timestamp) as session_date,
      MIN(toDate(timestamp)) OVER (PARTITION BY person_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as first_session,
      nth_value(toDate(timestamp), 2) OVER (PARTITION BY person_id ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as second_session
    FROM events
    WHERE
      event IN ('mockup_file_opened', 'mockup_editor_interaction')
      AND timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
  )
  WHERE second_session IS NOT NULL
  GROUP BY person_id
)
GROUP BY time_to_return
ORDER BY
  CASE time_to_return
    WHEN '< 1 day' THEN 1
    WHEN '1-7 days' THEN 2
    WHEN '7-30 days' THEN 3
    ELSE 4
  END
```

### Query 4: Mockup Interaction Types by User Cohort
```hogql
SELECT
  user_cohort,
  properties.interactionType as interaction_type,
  COUNT(*) as interaction_count,
  COUNT(DISTINCT person_id) as unique_users
FROM events
JOIN (
  SELECT
    person_id,
    CASE
      WHEN COUNT(DISTINCT toDate(timestamp)) = 1 THEN 'one_time'
      WHEN COUNT(DISTINCT toDate(timestamp)) < 5 THEN 'occasional'
      ELSE 'frequent'
    END as user_cohort
  FROM events
  WHERE
    event IN ('mockup_file_opened', 'mockup_editor_interaction')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id
) as cohorts USING (person_id)
WHERE
  event = 'mockup_editor_interaction'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.is_dev_user != true
  AND NOT has(['all_filtered_cohorts'], cohort)
GROUP BY user_cohort, interaction_type
ORDER BY user_cohort, interaction_count DESC
```

## Expected Insights
- Conversion rate from opening mockup files to editing them
- How quickly users begin editing after opening
- Repeat usage patterns and retention
- Most common interaction types by user engagement level

## Follow-up Questions
- What mockup interaction types predict repeat usage?
- Are there specific file types or sizes that correlate with higher editing rates?
- Do users who screenshot mockups have different retention than those who don't?
