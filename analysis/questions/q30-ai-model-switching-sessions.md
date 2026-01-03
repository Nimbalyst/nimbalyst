# AI Model Switching Sessions - Within-Session Provider Switches Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

How often do users switch AI providers within a single session? Identify whether switching indicates dissatisfaction (trying different models for same task) or workflow diversity (different models for different task types), and measure the time between provider switches.

---

## 2. Queries Used

### Query 1: Sessions with Provider Switches
```sql
WITH session_providers AS (
  SELECT properties.session_id,
         person_id,
         groupArray(properties.provider ORDER BY timestamp) as providers,
         groupArray(timestamp ORDER BY timestamp) as timestamps,
         count(DISTINCT properties.provider) as unique_providers,
         count(*) as total_messages
  FROM events
  WHERE event = 'ai_message_sent'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY properties.session_id, person_id
)
SELECT
  count(*) as total_sessions,
  countIf(unique_providers = 1) as single_provider_sessions,
  countIf(unique_providers = 2) as two_provider_sessions,
  countIf(unique_providers = 3) as three_provider_sessions,
  countIf(unique_providers >= 4) as four_plus_provider_sessions,
  round(countIf(unique_providers > 1) * 100.0 / count(*), 2) as pct_sessions_with_switches
FROM session_providers
```

### Query 2: Provider Switch Patterns
```sql
WITH session_messages AS (
  SELECT properties.session_id,
         person_id,
         properties.provider,
         timestamp,
         row_number() OVER (PARTITION BY properties.session_id ORDER BY timestamp) as msg_number,
         lag(properties.provider) OVER (PARTITION BY properties.session_id ORDER BY timestamp) as prev_provider
  FROM events
  WHERE event = 'ai_message_sent'
    AND timestamp >= now() - INTERVAL 90 DAY
),
switches AS (
  SELECT session_id,
         prev_provider as from_provider,
         provider as to_provider,
         count(*) as switch_count
  FROM session_messages
  WHERE prev_provider IS NOT NULL
    AND prev_provider != provider
  GROUP BY session_id, prev_provider, provider
)
SELECT from_provider,
       to_provider,
       count(*) as total_switches,
       count(DISTINCT session_id) as sessions_with_switch,
       round(avg(switch_count), 2) as avg_switches_per_session
FROM switches
GROUP BY from_provider, to_provider
ORDER BY total_switches DESC
LIMIT 20
```

### Query 3: Time Between Provider Switches
```sql
WITH session_messages AS (
  SELECT properties.session_id,
         person_id,
         properties.provider,
         timestamp,
         lag(properties.provider) OVER (PARTITION BY properties.session_id ORDER BY timestamp) as prev_provider,
         lag(timestamp) OVER (PARTITION BY properties.session_id ORDER BY timestamp) as prev_timestamp
  FROM events
  WHERE event = 'ai_message_sent'
    AND timestamp >= now() - INTERVAL 90 DAY
),
switch_times AS (
  SELECT session_id,
         prev_provider,
         provider,
         dateDiff('second', prev_timestamp, timestamp) as seconds_since_prev_msg
  FROM session_messages
  WHERE prev_provider IS NOT NULL
    AND prev_provider != provider
)
SELECT
  CASE
    WHEN seconds_since_prev_msg < 60 THEN '0-1min'
    WHEN seconds_since_prev_msg < 300 THEN '1-5min'
    WHEN seconds_since_prev_msg < 900 THEN '5-15min'
    WHEN seconds_since_prev_msg < 1800 THEN '15-30min'
    ELSE '30min+'
  END as time_range,
  count(*) as switch_count,
  round(count(*) * 100.0 / sum(count(*)) OVER (), 2) as pct_of_switches
FROM switch_times
GROUP BY time_range
ORDER BY min(seconds_since_prev_msg)
```

### Query 4: Same-Task Switching Detection
```sql
WITH session_messages AS (
  SELECT properties.session_id,
         person_id,
         properties.provider,
         properties.message_text,
         timestamp,
         lag(properties.provider) OVER (PARTITION BY properties.session_id ORDER BY timestamp) as prev_provider,
         lag(properties.message_text) OVER (PARTITION BY properties.session_id ORDER BY timestamp) as prev_message,
         lag(timestamp) OVER (PARTITION BY properties.session_id ORDER BY timestamp) as prev_timestamp
  FROM events
  WHERE event = 'ai_message_sent'
    AND timestamp >= now() - INTERVAL 90 DAY
),
potential_retries AS (
  SELECT session_id,
         prev_provider,
         provider,
         prev_message,
         message_text,
         dateDiff('second', prev_timestamp, timestamp) as time_gap
  FROM session_messages
  WHERE prev_provider IS NOT NULL
    AND prev_provider != provider
    AND time_gap < 300 -- switched within 5 minutes
    AND length(message_text) > 0
    AND length(prev_message) > 0
)
SELECT
  countIf(similarity(message_text, prev_message) > 0.7) as likely_retries,
  countIf(similarity(message_text, prev_message) <= 0.7) as likely_new_tasks,
  count(*) as total_quick_switches,
  round(countIf(similarity(message_text, prev_message) > 0.7) * 100.0 / count(*), 2) as pct_likely_retries
FROM potential_retries
```

### Query 5: Session Characteristics with Switches
```sql
WITH session_metrics AS (
  SELECT properties.session_id,
         person_id,
         count(DISTINCT properties.provider) as unique_providers,
         count(*) as total_messages,
         dateDiff('minute', min(timestamp), max(timestamp)) as session_duration_min,
         count(DISTINCT properties.conversation_id) as unique_conversations
  FROM events
  WHERE event = 'ai_message_sent'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY properties.session_id, person_id
)
SELECT
  CASE
    WHEN unique_providers = 1 THEN 'single_provider'
    WHEN unique_providers = 2 THEN 'two_providers'
    ELSE 'multi_provider'
  END as session_type,
  count(*) as session_count,
  round(avg(total_messages), 1) as avg_messages,
  round(avg(session_duration_min), 1) as avg_duration_min,
  round(avg(unique_conversations), 1) as avg_conversations
FROM session_metrics
GROUP BY session_type
ORDER BY session_count DESC
```

### Query 6: User Switching Behavior
```sql
WITH user_sessions AS (
  SELECT person_id,
         properties.session_id,
         count(DISTINCT properties.provider) as providers_in_session
  FROM events
  WHERE event = 'ai_message_sent'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id, properties.session_id
),
user_patterns AS (
  SELECT person_id,
         count(DISTINCT session_id) as total_sessions,
         countIf(providers_in_session > 1) as sessions_with_switches,
         round(countIf(providers_in_session > 1) * 100.0 / count(DISTINCT session_id), 2) as pct_sessions_with_switches
  FROM user_sessions
  GROUP BY person_id
)
SELECT
  CASE
    WHEN pct_sessions_with_switches = 0 THEN 'never_switches'
    WHEN pct_sessions_with_switches < 10 THEN 'rarely_switches'
    WHEN pct_sessions_with_switches < 30 THEN 'sometimes_switches'
    WHEN pct_sessions_with_switches < 60 THEN 'often_switches'
    ELSE 'frequently_switches'
  END as user_type,
  count(*) as user_count,
  round(avg(total_sessions), 1) as avg_sessions,
  round(avg(pct_sessions_with_switches), 1) as avg_switch_pct
FROM user_patterns
WHERE total_sessions >= 3 -- filter low-activity users
GROUP BY user_type
ORDER BY user_count DESC
```

---

## 3. Raw Results

### Session-Level Provider Switching

| Session Type | Count | % of Total Sessions |
|-------------|-------|-------------------|
| Single provider | [TBD] | [TBD]% |
| 2 providers | [TBD] | [TBD]% |
| 3 providers | [TBD] | [TBD]% |
| 4+ providers | [TBD] | [TBD]% |

**Overall Switch Rate:** [TBD]% of sessions have provider switches

### Most Common Provider Switches

| From → To | Total Switches | Sessions | Avg Switches/Session |
|-----------|---------------|----------|---------------------|
| [claude → openai] | [TBD] | [TBD] | [TBD] |
| [openai → claude] | [TBD] | [TBD] | [TBD] |
| [claude-code → claude] | [TBD] | [TBD] | [TBD] |

### Time Between Switches

| Time Range | Switches | % of All Switches |
|-----------|----------|------------------|
| 0-1 minute | [TBD] | [TBD]% |
| 1-5 minutes | [TBD] | [TBD]% |
| 5-15 minutes | [TBD] | [TBD]% |
| 15-30 minutes | [TBD] | [TBD]% |
| 30+ minutes | [TBD] | [TBD]% |

### Same-Task vs. New-Task Switching

| Switch Type | Count | % of Quick Switches (<5 min) |
|------------|-------|----------------------------|
| Likely retry (similar messages) | [TBD] | [TBD]% |
| Likely new task (different messages) | [TBD] | [TBD]% |

### Session Characteristics by Provider Usage

| Session Type | Sessions | Avg Messages | Avg Duration | Avg Conversations |
|-------------|----------|-------------|--------------|------------------|
| Single provider | [TBD] | [TBD] | [TBD] min | [TBD] |
| Two providers | [TBD] | [TBD] | [TBD] min | [TBD] |
| Multi-provider | [TBD] | [TBD] | [TBD] min | [TBD] |

### User Switching Patterns

| User Type | User Count | Avg Sessions | Avg % Sessions with Switches |
|----------|-----------|-------------|----------------------------|
| never_switches | [TBD] | [TBD] | 0% |
| rarely_switches | [TBD] | [TBD] | [TBD]% |
| sometimes_switches | [TBD] | [TBD] | [TBD]% |
| often_switches | [TBD] | [TBD] | [TBD]% |
| frequently_switches | [TBD] | [TBD] | [TBD]% |

---

## 4. Visualizations

### Recommended Charts

1. **Pie Chart: Session Distribution by Provider Count**
   - Segments: 1, 2, 3, 4+ providers
   - Shows how common switching is

2. **Sankey Diagram: Provider Switching Flows**
   - Left: From providers
   - Right: To providers
   - Width represents switch frequency
   - Shows bidirectional patterns

3. **Histogram: Time Between Switches**
   - X-axis: Time buckets
   - Y-axis: Number of switches
   - Shows typical switching cadence

4. **Grouped Bar Chart: Session Metrics by Provider Count**
   - Groups: Single, Two, Multi-provider
   - Bars: Messages, Duration, Conversations
   - Normalized for comparison

5. **Stacked Bar Chart: User Switching Behavior**
   - X-axis: User types (never to frequently)
   - Y-axis: Count
   - Shows distribution of switching habits

---

## 5. Takeaways

### Expected Findings

1. **Low within-session switching (<20%):**
   - Users generally commit to a provider for a session
   - Switching indicates specific needs or issues

2. **Quick switches (<5 min) likely indicate retry:**
   - User unsatisfied with first response
   - Trying different model for same task
   - Quality or performance issue

3. **Long gaps between switches (>15 min):**
   - Context change / new task
   - Workflow diversity (different models for different jobs)
   - Not dissatisfaction-driven

### Potential Insights

4. **Bidirectional switching patterns:**
   - If claude ↔ openai is balanced: Users A/B testing
   - If one-way dominant: Clear preference emerging

5. **Multi-provider sessions:**
   - If longer duration: Power users exploring capabilities
   - If shorter: Users confused or frustrated

6. **User segmentation:**
   - "Never switchers": Loyal or satisfied
   - "Frequent switchers": Power users or dissatisfied users

---

## 6. Suggested Actions / Product Direction

### If Quick Switches Are Common (>30%)

1. **Investigate dissatisfaction:**
   - What triggers quick retries?
   - Quality issues with specific providers?
   - Latency/timeout problems?

2. **Improve first response quality:**
   - Better model routing
   - Context-aware provider selection
   - A/B test different models automatically

3. **Add explicit comparison features:**
   - "Try with another model" button
   - Side-by-side response comparison
   - Vote for best response

### If Switching Indicates Workflow Diversity

4. **Task-based provider selection:**
   - "Best for coding" / "Best for writing" labels
   - Auto-suggest provider based on task type
   - Quick provider switching UI

5. **Context-aware defaults:**
   - Remember provider per file type
   - Learn user's provider preferences by task
   - Seamless switching without disruption

### If Multi-Provider Sessions Are Long

6. **Support power user workflows:**
   - Keyboard shortcuts for provider switching
   - Provider presets
   - Advanced comparison features

7. **Session insights:**
   - Show provider usage stats per session
   - "You switched 3 times this session"
   - Help users understand their patterns

### General Improvements

8. **Reduce friction for switching:**
   - One-click provider change
   - Maintain conversation context across switches
   - No need to reconfigure each time

9. **Analytics and learning:**
   - Track which provider gives better results
   - Auto-recommend based on success patterns
   - "Users like you prefer X for this task"

10. **Transparency and education:**
    - Explain when/why to use each provider
    - Show provider strengths in UI
    - Help users make informed choices

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `ai_message_sent` with provider property
- **Session Definition:** Grouped by session_id
- **Similarity Threshold:** 0.7 similarity score for detecting retries
- **Quick Switch Window:** 5 minutes between messages
- **Minimum Sessions:** 3+ sessions for user pattern analysis
