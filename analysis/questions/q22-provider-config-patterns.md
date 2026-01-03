# Q22: AI Provider Configuration and Retention

## Question
How does the number of configured AI providers correlate with user retention at 7, 30, and 90 days?

## Hypothesis
Users who configure multiple AI providers are more invested in the product and will show higher retention rates across all time periods.

## Key Metrics
- Distribution of users by provider count (0, 1, 2, 3+)
- Retention rates at 7, 30, and 90 days by provider count
- Time to configure additional providers
- Provider diversity impact on AI usage frequency

## PostHog Analysis

### Query 1: User Distribution by Provider Count
```hogql
SELECT
  provider_count_bucket,
  COUNT(DISTINCT person_id) as user_count,
  (COUNT(DISTINCT person_id) * 100.0 / SUM(COUNT(DISTINCT person_id)) OVER ()) as percentage
FROM (
  SELECT
    person_id,
    CASE
      WHEN provider_count = 0 THEN '0 providers'
      WHEN provider_count = 1 THEN '1 provider'
      WHEN provider_count = 2 THEN '2 providers'
      ELSE '3+ providers'
    END as provider_count_bucket
  FROM (
    SELECT
      person_id,
      COUNT(DISTINCT properties.providerId) as provider_count
    FROM events
    WHERE
      event = 'ai_provider_configured'
      AND timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  )
)
GROUP BY provider_count_bucket
ORDER BY
  CASE provider_count_bucket
    WHEN '0 providers' THEN 0
    WHEN '1 provider' THEN 1
    WHEN '2 providers' THEN 2
    ELSE 3
  END
```

### Query 2: Retention by Provider Count
```hogql
SELECT
  provider_count_bucket,
  COUNT(DISTINCT person_id) as cohort_size,
  COUNT(DISTINCT CASE WHEN retained_7_day THEN person_id END) as retained_7,
  COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) as retained_30,
  COUNT(DISTINCT CASE WHEN retained_90_day THEN person_id END) as retained_90,
  (COUNT(DISTINCT CASE WHEN retained_7_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_7_day,
  (COUNT(DISTINCT CASE WHEN retained_30_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_30_day,
  (COUNT(DISTINCT CASE WHEN retained_90_day THEN person_id END) * 100.0 / COUNT(DISTINCT person_id)) as retention_90_day
FROM (
  SELECT
    person_id,
    first_seen,
    provider_count,
    CASE
      WHEN provider_count = 0 THEN '0 providers'
      WHEN provider_count = 1 THEN '1 provider'
      WHEN provider_count = 2 THEN '2 providers'
      ELSE '3+ providers'
    END as provider_count_bucket,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 7 DAY
        AND timestamp < first_seen + INTERVAL 14 DAY
      THEN 1 ELSE 0
    END) as retained_7_day,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 30 DAY
        AND timestamp < first_seen + INTERVAL 37 DAY
      THEN 1 ELSE 0
    END) as retained_30_day,
    MAX(CASE
      WHEN timestamp >= first_seen + INTERVAL 90 DAY
        AND timestamp < first_seen + INTERVAL 97 DAY
      THEN 1 ELSE 0
    END) as retained_90_day
  FROM events
  JOIN (
    SELECT
      person_id,
      MIN(timestamp) as first_seen,
      COUNT(DISTINCT CASE
        WHEN event = 'ai_provider_configured'
          AND timestamp <= MIN(timestamp) + INTERVAL 7 DAY
        THEN properties.providerId
      END) as provider_count
    FROM events
    WHERE
      timestamp >= now() - INTERVAL 120 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as user_cohort USING (person_id)
  WHERE
    timestamp >= now() - INTERVAL 120 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
  GROUP BY person_id, first_seen, provider_count
)
WHERE first_seen <= now() - INTERVAL 90 DAY
GROUP BY provider_count_bucket
ORDER BY
  CASE provider_count_bucket
    WHEN '0 providers' THEN 0
    WHEN '1 provider' THEN 1
    WHEN '2 providers' THEN 2
    ELSE 3
  END
```

### Query 3: Time to Configure Additional Providers
```hogql
SELECT
  provider_sequence,
  quantile(0.5)(days_since_first) as median_days,
  quantile(0.75)(days_since_first) as p75_days,
  quantile(0.95)(days_since_first) as p95_days,
  COUNT(*) as occurrence_count
FROM (
  SELECT
    person_id,
    properties.providerId as provider_id,
    row_number() OVER (PARTITION BY person_id ORDER BY timestamp) as provider_sequence,
    dateDiff('day',
      MIN(timestamp) OVER (PARTITION BY person_id),
      timestamp
    ) as days_since_first
  FROM events
  WHERE
    event = 'ai_provider_configured'
    AND timestamp >= now() - INTERVAL 90 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
)
WHERE provider_sequence BETWEEN 2 AND 5
GROUP BY provider_sequence
ORDER BY provider_sequence
```

### Query 4: AI Usage Frequency by Provider Count
```hogql
SELECT
  provider_count_bucket,
  COUNT(DISTINCT person_id) as users,
  COUNT(*) as total_ai_messages,
  COUNT(*) / COUNT(DISTINCT person_id) as avg_messages_per_user,
  COUNT(DISTINCT properties.$session_id) / COUNT(DISTINCT person_id) as avg_ai_sessions_per_user,
  COUNT(*) / COUNT(DISTINCT toDate(timestamp)) as avg_messages_per_active_day
FROM (
  SELECT
    events.person_id,
    events.timestamp,
    events.properties,
    CASE
      WHEN provider_counts.provider_count = 1 THEN '1 provider'
      WHEN provider_counts.provider_count = 2 THEN '2 providers'
      WHEN provider_counts.provider_count >= 3 THEN '3+ providers'
      ELSE '0 providers'
    END as provider_count_bucket
  FROM events
  LEFT JOIN (
    SELECT
      person_id,
      COUNT(DISTINCT properties.providerId) as provider_count
    FROM events
    WHERE
      event = 'ai_provider_configured'
      AND timestamp >= now() - INTERVAL 90 DAY
      AND properties.is_dev_user != true
      AND NOT has(['all_filtered_cohorts'], cohort)
    GROUP BY person_id
  ) as provider_counts USING (person_id)
  WHERE
    events.event = 'ai_message_sent'
    AND events.timestamp >= now() - INTERVAL 30 DAY
    AND events.properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], events.cohort)
)
GROUP BY provider_count_bucket
ORDER BY
  CASE provider_count_bucket
    WHEN '0 providers' THEN 0
    WHEN '1 provider' THEN 1
    WHEN '2 providers' THEN 2
    ELSE 3
  END
```

## Expected Insights
- Distribution of users by number of configured providers
- Clear correlation (or lack thereof) between provider count and retention
- Timeline for users to configure additional providers
- Impact of provider diversity on AI feature usage intensity

## Follow-up Questions
- Which specific provider combinations correlate with highest retention?
- Do users who configure providers in first week have better retention than later configurers?
- Is there an optimal number of providers that balances choice with complexity?
