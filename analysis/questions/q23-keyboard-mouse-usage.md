# Q23: Keyboard Shortcut vs Mouse/Toolbar Usage

## Question
What are the keyboard shortcut vs toolbar usage ratios, and how do these patterns differ by user tenure?

## Hypothesis
Power users and longer-tenured users adopt keyboard shortcuts over time, while new users rely more on toolbar/mouse interactions.

## Key Metrics
- Keyboard shortcut usage rate vs toolbar clicks
- Shortcut adoption timeline by user cohort
- Most commonly used shortcuts vs toolbar actions
- Correlation between shortcut usage and session efficiency

## PostHog Analysis

### Query 1: Overall Keyboard vs Mouse Usage Ratio
```hogql
SELECT
  interaction_type,
  COUNT(*) as total_interactions,
  COUNT(DISTINCT person_id) as unique_users,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()) as percentage_of_interactions
FROM (
  SELECT
    person_id,
    CASE
      WHEN event = 'keyboard_shortcut_used' THEN 'keyboard'
      WHEN event = 'toolbar_action_clicked' THEN 'toolbar'
      ELSE 'other'
    END as interaction_type
  FROM events
  WHERE
    event IN ('keyboard_shortcut_used', 'toolbar_action_clicked')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
GROUP BY interaction_type
ORDER BY total_interactions DESC
```

### Query 2: Usage Patterns by User Tenure
```hogql
SELECT
  tenure_bucket,
  interaction_type,
  COUNT(*) as interaction_count,
  COUNT(DISTINCT person_id) as unique_users,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY tenure_bucket)) as pct_within_tenure
FROM (
  SELECT
    person_id,
    timestamp,
    CASE
      WHEN event = 'keyboard_shortcut_used' THEN 'keyboard'
      WHEN event = 'toolbar_action_clicked' THEN 'toolbar'
    END as interaction_type,
    CASE
      WHEN dateDiff('day', user_first_seen, timestamp) < 7 THEN '0-7 days'
      WHEN dateDiff('day', user_first_seen, timestamp) < 30 THEN '7-30 days'
      WHEN dateDiff('day', user_first_seen, timestamp) < 90 THEN '30-90 days'
      ELSE '90+ days'
    END as tenure_bucket
  FROM events
  JOIN (
    SELECT
      person_id,
      MIN(timestamp) as user_first_seen
    FROM events
    WHERE
      timestamp >= now() - INTERVAL 120 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as user_cohorts USING (person_id)
  WHERE
    event IN ('keyboard_shortcut_used', 'toolbar_action_clicked')
    AND timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
GROUP BY tenure_bucket, interaction_type
ORDER BY
  CASE tenure_bucket
    WHEN '0-7 days' THEN 1
    WHEN '7-30 days' THEN 2
    WHEN '30-90 days' THEN 3
    ELSE 4
  END,
  interaction_type
```

### Query 3: Most Common Shortcuts and Toolbar Actions
```hogql
SELECT
  interaction_type,
  action_name,
  COUNT(*) as usage_count,
  COUNT(DISTINCT person_id) as unique_users,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY interaction_type)) as pct_of_type
FROM (
  SELECT
    person_id,
    CASE
      WHEN event = 'keyboard_shortcut_used' THEN 'keyboard'
      WHEN event = 'toolbar_action_clicked' THEN 'toolbar'
    END as interaction_type,
    CASE
      WHEN event = 'keyboard_shortcut_used' THEN properties.shortcut
      WHEN event = 'toolbar_action_clicked' THEN properties.action
    END as action_name
  FROM events
  WHERE
    event IN ('keyboard_shortcut_used', 'toolbar_action_clicked')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
WHERE action_name IS NOT NULL
GROUP BY interaction_type, action_name
HAVING usage_count >= 10
ORDER BY interaction_type, usage_count DESC
LIMIT 40
```

### Query 4: Shortcut Adoption Timeline
```hogql
SELECT
  days_since_first_use,
  COUNT(DISTINCT person_id) as users_who_adopted,
  AVG(shortcut_count) as avg_shortcuts_used,
  SUM(shortcut_count) as total_shortcuts
FROM (
  SELECT
    person_id,
    dateDiff('day', user_first_seen, first_shortcut_use) as days_since_first_use,
    COUNT(DISTINCT properties.shortcut) as shortcut_count
  FROM events
  JOIN (
    SELECT
      person_id,
      MIN(timestamp) as user_first_seen
    FROM events
    WHERE
      timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as user_cohorts USING (person_id)
  JOIN (
    SELECT
      person_id,
      MIN(timestamp) as first_shortcut_use
    FROM events
    WHERE
      event = 'keyboard_shortcut_used'
      AND timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as shortcut_adoption USING (person_id)
  WHERE
    event = 'keyboard_shortcut_used'
    AND timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id, user_first_seen, first_shortcut_use
)
WHERE days_since_first_use >= 0 AND days_since_first_use < 90
GROUP BY days_since_first_use
ORDER BY days_since_first_use
```

### Query 5: Shortcut Usage and Retention Correlation
```hogql
SELECT
  uses_shortcuts,
  COUNT(DISTINCT person_id) as cohort_size,
  COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) as retained_30,
  (COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_rate_30_day
FROM (
  SELECT
    person_id,
    first_seen,
    MAX(CASE WHEN event = 'keyboard_shortcut_used' THEN 1 ELSE 0 END) as uses_shortcuts,
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
  WHERE
    timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id, first_seen
)
WHERE first_seen <= now() - INTERVAL 30 DAY
GROUP BY uses_shortcuts
ORDER BY uses_shortcuts DESC
```

## Expected Insights
- Overall split between keyboard shortcut and toolbar usage
- How shortcut adoption increases with user tenure
- Most popular shortcuts and their equivalent toolbar actions
- Timeline for users to discover and adopt shortcuts
- Correlation between shortcut usage and user retention

## Follow-up Questions
- Which shortcuts have the highest adoption rates among new users?
- Are there toolbar actions without keyboard shortcuts that should have them?
- Do specific shortcuts correlate with power user behavior or retention?
