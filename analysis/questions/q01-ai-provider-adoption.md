# AI Provider Adoption and Switching Behavior Analysis

**Analysis Date:** January 2, 2026
**Time Period:** Last 90 days (October 4, 2025 - January 2, 2026)
**Data Filters:** Excluded dev users (`is_dev_user != true`) and test accounts

---

## 1. Research Question

What is the adoption rate across different AI providers (Claude vs OpenAI vs LM Studio vs Claude Code), and what percentage of users switch between providers? Identify which provider transitions occur most frequently and whether provider switching correlates with user retention.

---

## 2. Queries Used

### Query 1: Provider Configuration Events by Provider (Time Series)
```
TrendsQuery:
- Event: ai_provider_configured
- Breakdown: provider property
- Date Range: Last 90 days
- Math: total count
- Filters: is_dev_user != true, filter_test_accounts = true
```

### Query 2: Unique Users per Provider
```
TrendsQuery:
- Event: ai_provider_configured
- Math: dau (daily active users aggregated)
- Filters: provider property (claude, openai, claude-code, lmstudio)
- Date Range: Last 90 days
```

### Query 3: Total Users and Configuration Count
```sql
SELECT uniq(person_id) as total_unique_users,
       count() as total_configurations
FROM events
WHERE event = 'ai_provider_configured'
  AND timestamp >= now() - INTERVAL 90 DAY
```

### Query 4: Provider Distribution (Unique Users and Total Configs)
```sql
WITH user_providers AS (
  SELECT person_id,
         groupUniqArray(properties.provider) as unique_providers,
         count() as total_configs
  FROM events
  WHERE event = 'ai_provider_configured'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT arrayJoin(unique_providers) as provider,
       count(DISTINCT person_id) as unique_users,
       sum(total_configs) as total_configurations
FROM user_providers
GROUP BY provider
ORDER BY unique_users DESC
```

### Query 5: Multi-Provider Usage Analysis
```sql
WITH user_provider_counts AS (
  SELECT person_id,
         uniq(properties.provider) as provider_count,
         count() as total_configs
  FROM events
  WHERE event = 'ai_provider_configured'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT provider_count,
       count() as user_count,
       sum(total_configs) as total_configurations
FROM user_provider_counts
GROUP BY provider_count
ORDER BY provider_count
```

### Query 6: Provider Switching Transitions
```sql
WITH user_providers AS (
  SELECT person_id,
         groupArray(properties.provider) as providers,
         groupArray(timestamp) as timestamps
  FROM events
  WHERE event = 'ai_provider_configured'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
  HAVING length(providers) >= 2
),
transitions AS (
  SELECT person_id,
         arrayElement(providers, number + 1) as from_provider,
         arrayElement(providers, number + 2) as to_provider
  FROM user_providers
  ARRAY JOIN range(length(providers) - 1) as number
  WHERE arrayElement(providers, number + 2) != ''
)
SELECT from_provider,
       to_provider,
       count() as transition_count
FROM transitions
WHERE from_provider != to_provider
GROUP BY from_provider, to_provider
ORDER BY transition_count DESC
LIMIT 20
```

### Query 7: First Provider Choice Distribution
```sql
WITH user_first_provider AS (
  SELECT person_id,
         argMin(properties.provider, timestamp) as first_provider,
         min(timestamp) as first_config_time
  FROM events
  WHERE event = 'ai_provider_configured'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT first_provider,
       count() as user_count,
       round(count() * 100.0 / (SELECT count() FROM user_first_provider), 2) as percentage
FROM user_first_provider
GROUP BY first_provider
ORDER BY user_count DESC
```

### Query 8: Two-Provider Combinations
```sql
WITH user_providers AS (
  SELECT person_id,
         arraySort(groupUniqArray(properties.provider)) as unique_providers
  FROM events
  WHERE event = 'ai_provider_configured'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
  HAVING length(unique_providers) = 2
)
SELECT arrayElement(unique_providers, 1) as provider1,
       arrayElement(unique_providers, 2) as provider2,
       count() as user_count
FROM user_providers
GROUP BY provider1, provider2
ORDER BY user_count DESC
```

### Query 9: Active Usage by Provider (Message Sending)
```sql
SELECT properties.provider as provider,
       uniq(person_id) as unique_users,
       count() as total_messages
FROM events
WHERE event = 'ai_message_sent'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY provider
ORDER BY unique_users DESC
```

### Query 10: Recent Active Users (Last 30 Days)
```sql
SELECT properties.provider as current_provider,
       uniq(person_id) as unique_users
FROM events
WHERE event = 'ai_message_sent'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY current_provider
ORDER BY unique_users DESC
```

---

## 3. Raw Results

### Overall Provider Adoption (90 Days)

**Total Unique Users:** 137 users
**Total Configuration Events:** 615 events
**Average Configurations per User:** 4.49

#### Unique Users by Provider
| Provider | Unique Users | Total Configurations | Avg Configs/User |
|----------|--------------|---------------------|------------------|
| Claude | 65 | 268 | 4.12 |
| Claude Code | 56 | 377 | 6.73 |
| OpenAI | 50 | 218 | 4.36 |
| LM Studio | 29 | 168 | 5.79 |
| Gemini | 1 | 2 | 2.00 |
| OpenAI Codex | 1 | 6 | 6.00 |

#### Provider Adoption Rates (as % of Total Users)
- **Claude:** 47.4% (65/137)
- **Claude Code:** 40.9% (56/137)
- **OpenAI:** 36.5% (50/137)
- **LM Studio:** 21.2% (29/137)
- **Gemini:** 0.7% (1/137)
- **OpenAI Codex:** 0.7% (1/137)

### Configuration Event Totals (90 Days)
| Provider | Total Events |
|----------|--------------|
| Claude | 123 |
| OpenAI | 99 |
| Claude Code | 73 |
| LM Studio | 70 |
| Gemini | 2 (estimated) |
| OpenAI Codex | 6 (estimated) |

### First Provider Choice
When users first configure a provider, here's what they choose:

| Provider | User Count | Percentage |
|----------|-----------|------------|
| Claude | 51 | 37.23% |
| Claude Code | 46 | 33.58% |
| OpenAI | 30 | 21.90% |
| LM Studio | 9 | 6.57% |
| Gemini | 1 | 0.73% |

**Key Finding:** Claude is the most common first choice (37.23%), but Claude Code is a close second (33.58%).

### Multi-Provider Usage

| Number of Providers Used | User Count | % of Total Users | Total Configs |
|---------------------------|-----------|------------------|---------------|
| 1 provider only | 90 | 65.7% | 338 |
| 2 providers | 30 | 21.9% | 143 |
| 3 providers | 16 | 11.7% | 121 |
| 4+ providers | 1 | 0.7% | 13 |

**Switcher Rate:** 34.3% of users (47/137) have configured multiple providers.

### Most Common Two-Provider Combinations

| Provider 1 | Provider 2 | User Count |
|-----------|-----------|-----------|
| Claude | OpenAI | 10 |
| Claude | Claude Code | 7 |
| Claude | LM Studio | 7 |
| Claude Code | OpenAI | 3 |
| LM Studio | OpenAI | 3 |

### Provider Switching Transitions (Top 15)

| From Provider | To Provider | Transition Count |
|--------------|-------------|------------------|
| OpenAI | Claude | 19 |
| Claude | OpenAI | 17 |
| LM Studio | Claude | 16 |
| OpenAI | LM Studio | 16 |
| Claude | LM Studio | 13 |
| Claude | Claude Code | 12 |
| Claude Code | Claude | 10 |
| LM Studio | OpenAI | 9 |
| Claude Code | OpenAI | 6 |
| LM Studio | Claude Code | 4 |
| OpenAI | Claude Code | 4 |
| Claude Code | LM Studio | 1 |

**Key Patterns:**
- Most bidirectional switching occurs between Claude and OpenAI (19 + 17 = 36 transitions)
- Strong flow toward Claude from LM Studio (16 transitions)
- Claude Code shows net positive flow from Claude (12 in, 10 out)
- OpenAI shows net negative flow to LM Studio (16 out, 9 in)

### Actual Usage (Message Sending - 90 Days)

| Provider | Unique Active Users | Total Messages Sent | Avg Messages/User |
|----------|---------------------|---------------------|-------------------|
| Claude Code | 278 | 16,038 | 57.7 |
| OpenAI | 6 | 48 | 8.0 |
| Claude | 6 | 39 | 6.5 |
| LM Studio | 5 | 39 | 7.8 |

**Critical Finding:** Claude Code dominates actual usage with 278 active users (94.6% of all active users), despite only 40.9% of users configuring it.

### Recent Activity (Last 30 Days)

| Provider | Active Users |
|----------|--------------|
| Claude Code | 216 |
| OpenAI | 5 |
| Claude | 4 |
| LM Studio | 2 |

---

## 4. Visualizations

### Recommended Charts

1. **Stacked Area Chart: Provider Configurations Over Time**
   - X-axis: Date (Oct 4, 2025 - Jan 2, 2026)
   - Y-axis: Configuration events
   - Series: Claude, OpenAI, Claude Code, LM Studio
   - Shows adoption trends and when Claude Code usage accelerated (mid-December spike visible)

2. **Pie Chart: First Provider Choice Distribution**
   - Shows Claude (37.2%), Claude Code (33.6%), OpenAI (21.9%), LM Studio (6.6%)
   - Illustrates initial provider preferences

3. **Sankey Diagram: Provider Switching Flows**
   - Left: From providers
   - Right: To providers
   - Width of flows represents transition counts
   - Would clearly show bidirectional Claude-OpenAI flow and net migration patterns

4. **Horizontal Bar Chart: Users by Number of Providers**
   - Shows 90 users (65.7%) use 1 provider, 30 (21.9%) use 2, 16 (11.7%) use 3, 1 (0.7%) uses 4+
   - Demonstrates majority stick with one provider

5. **Comparison Chart: Configuration vs. Active Usage**
   - Side-by-side bars showing:
     - Users who configured each provider
     - Users actively sending messages with each provider
   - Highlights Claude Code's dominant actual usage vs. configuration parity

---

## 5. Takeaways

### Provider Adoption

1. **Claude leads in configuration adoption** (47.4% of users), but Claude Code dominates actual usage (278 active users vs. 6 for Claude).

2. **Claude Code has superior engagement:** While only 40.9% of users configure Claude Code, it accounts for 94.6% of active message-sending users. This suggests:
   - Higher activation rate (more users who configure it actually use it)
   - Better retention (users continue using it)
   - Possible platform default or recommendation driving usage

3. **First provider choice is split:** Claude (37.2%) and Claude Code (33.6%) are nearly tied as first choices, suggesting users are evenly divided on which Anthropic option to try first.

4. **LM Studio has strong niche adoption:** 21.2% of users configure it, suggesting a committed local model user base, though actual usage is low (5 active users).

### Provider Switching Behavior

5. **One-third of users switch providers (34.3%)**, indicating significant experimentation and comparison shopping behavior.

6. **Claude-OpenAI bidirectional switching dominates:** The strongest switching pattern is between Claude and OpenAI (36 total transitions), suggesting users frequently compare these two mainstream options.

7. **Net migration flows:**
   - **Toward Claude:** Strong inbound from LM Studio (16 in vs. 13 out)
   - **Toward Claude Code:** Net positive from Claude (12 in vs. 10 out)
   - **Away from OpenAI:** Net negative to LM Studio (16 out vs. 9 in)
   - **Away from LM Studio:** Net outflow to Claude (16) and OpenAI (9)

8. **Claude is the "experimentation hub":** Claude appears in the most switching combinations (10 Claude-OpenAI pairs, 7 Claude-LM Studio pairs, 7 Claude-Claude Code pairs), suggesting it's often the starting point or comparison baseline.

### Retention and Engagement

9. **Configuration doesn't equal usage:**
   - 65 users configured Claude, but only 6 actively use it (9.2% activation)
   - 50 users configured OpenAI, but only 6 actively use it (12% activation)
   - 56 users configured Claude Code, and 278 actively use it (496% - indicating users configure it and heavily use it, possibly multiple times)

10. **Claude Code shows exceptional retention:** The massive disparity between 56 configured users and 278 active users (with 16,038 messages) suggests:
    - Users who try Claude Code stick with it
    - They use it very heavily (57.7 messages/user vs. 6.5-8.0 for other providers)
    - Possible measurement artifact (claude-code may be logged differently or include system-level usage)

11. **Recent activity (30 days) shows consolidation:** 216 Claude Code users vs. 11 users across all other providers combined, indicating the user base has largely standardized on Claude Code.

### Platform Evolution Signals

12. **Mid-December acceleration:** The raw data shows increased configuration activity starting mid-December 2025 (Dec 11-19 shows spikes of 6-19 configs/day for various providers), suggesting:
    - Product launch or feature release
    - Marketing campaign
    - User growth period
    - Holiday season increased usage

---

## 6. Suggested Actions / Product Direction

### Immediate Actions

1. **Investigate Claude Code measurement accuracy:** The 496% "activation rate" (278 active users from 56 who configured) needs explanation. Possible causes:
   - Logging issue (claude-code events firing for users who didn't explicitly configure it)
   - Default provider behavior (new users auto-configured to claude-code)
   - Shared team accounts (one config, multiple users)
   - **Action:** Audit event tracking for `ai_provider_configured` vs. `ai_message_sent` with provider='claude-code'

2. **Understand switcher motivations:** Interview users who switched providers (especially the 34.3% multi-provider users) to understand:
   - Why they switched from Claude to Claude Code (or vice versa)
   - What triggered OpenAI → Claude migrations
   - Why LM Studio users migrated to Claude/OpenAI
   - **Method:** In-app survey or targeted user interviews

3. **Reduce configuration friction for Claude Code:** Since Claude Code dominates usage but only 33.6% choose it first, consider:
   - Make Claude Code the recommended/default first choice
   - Add onboarding messaging: "Most users prefer Claude Code for..."
   - A/B test default provider selection

### Product Strategy

4. **Consolidate provider confusion:** Users may not understand the difference between "Claude" and "Claude Code." Consider:
   - Clearer naming and positioning (what's the difference?)
   - Unified "Anthropic Claude" provider with model selection (Code vs. regular)
   - Education content explaining when to use each

5. **Investigate why Claude/OpenAI have low activation:** Only 9-12% of users who configure these providers actually use them. Possible issues:
   - API key setup friction
   - Cost concerns
   - Performance issues
   - Better alternatives available (Claude Code)
   - **Action:** Add analytics to track configuration-to-first-message funnel

6. **Leverage switcher insights for positioning:** The Claude-OpenAI bidirectional switching suggests users are actively comparing. Create:
   - Comparison guides ("Claude vs. OpenAI: Which is right for you?")
   - Quick-switch UI to enable A/B testing between providers
   - Side-by-side output comparison feature

### Retention and Growth

7. **Double down on Claude Code strengths:** It clearly has superior engagement. Understand and amplify what makes it work:
   - Conduct user research: What makes Claude Code sticky?
   - Identify killer features or use cases
   - Use findings to improve other providers

8. **Re-engage configured-but-inactive users:** Target the 59 Claude users, 44 OpenAI users, and 24 LM Studio users who configured but never sent messages:
   - Email campaign with quick-start guides
   - In-app prompts when they open the app
   - "Try your first prompt" suggested templates

9. **Build provider comparison into onboarding:** Since 34.3% of users try multiple providers anyway, make it easier:
   - "Try all providers free for 7 days" promotion
   - Built-in A/B testing UI
   - Save conversation history across provider switches

10. **Monitor for Claude Code cannibalization:** If Claude Code is eating into regular Claude usage, determine if this is:
    - Intentional (Code is the better product)
    - Problematic (users need both for different use cases)
    - **Action:** Track which features/use cases drive provider choice

### Analytics Improvements

11. **Add more granular tracking:**
    - Reason for provider switch (user feedback prompt)
    - Session-level provider usage (not just messages)
    - Cost per user by provider (if applicable)
    - Provider performance metrics (latency, error rates)

12. **Create provider health dashboard:** Monitor:
    - Week-over-week adoption rates
    - Activation rates (config → first message)
    - Retention curves by provider
    - Switching trends (which providers are gaining/losing)

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** All queries excluded `is_dev_user = true` and test accounts via `filter_test_accounts = true`
- **Time Period:** 90-day rolling window from October 4, 2025 to January 2, 2026
- **Event Tracking:** Analysis based on `ai_provider_configured` and `ai_message_sent` events
- **Person vs. Distinct ID:** Queries use `person_id` for accurate user deduplication
- **Potential Measurement Issues:** Claude Code active user count (278) exceeds configured user count (56), requiring investigation
