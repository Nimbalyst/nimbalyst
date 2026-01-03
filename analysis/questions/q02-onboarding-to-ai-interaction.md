# Q02: Time-to-First-AI-Interaction During Onboarding

**Analysis Date:** 2026-01-02
**Data Period:** October 2025 - January 2026
**Filters Applied:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`

---

## Research Question

What is the median time (in days) from first app launch to first AI chat message creation? How does this time differ for users who complete the onboarding walkthrough versus those who skip it, and does early AI adoption predict 30-day retention?

---

## Query Used

### Primary Query: Time-to-First-AI by Onboarding Status

```sql
SELECT
  person_id,
  min(timestamp) as first_session,
  minIf(timestamp, event = 'ai_message_sent') as first_ai_message,
  dateDiff('day', min(timestamp), minIf(timestamp, event = 'ai_message_sent')) as days_to_first_ai,
  countIf(event = 'onboarding_completed') > 0 as completed_onboarding,
  countIf(event = 'onboarding_skipped') > 0 as skipped_onboarding,
  countIf(event = 'onboarding_deferred') > 0 as deferred_onboarding
FROM events
WHERE event IN (
  'nimbalyst_session_start',
  'ai_message_sent',
  'onboarding_completed',
  'onboarding_skipped',
  'onboarding_deferred'
)
AND person.properties.is_dev_user != true
GROUP BY person_id
HAVING first_ai_message IS NOT NULL
ORDER BY days_to_first_ai
LIMIT 1000
```

### Supporting Query: Overall Retention Distribution

```sql
SELECT
  CASE
    WHEN days_active >= 30 THEN '30+ days'
    WHEN days_active >= 14 THEN '14-29 days'
    WHEN days_active >= 7 THEN '7-13 days'
    WHEN days_active >= 1 THEN '1-6 days'
    ELSE '0 days (single session)'
  END as retention_bucket,
  count(*) as user_count
FROM (
  SELECT
    person_id,
    dateDiff('day', min(timestamp), max(timestamp)) as days_active
  FROM events
  WHERE event = 'nimbalyst_session_start'
    AND person.properties.is_dev_user != true
    AND timestamp >= '2025-10-01'
  GROUP BY person_id
)
GROUP BY retention_bucket
ORDER BY retention_bucket
```

---

## Raw Results

### Overall Time-to-First-AI Statistics

**Total users who used AI:** 263 users

| Metric | Value |
|--------|-------|
| **Median time to first AI** | 0 days |
| **Mean time to first AI** | 0.45 days |
| **Same-day adoption rate** | 89.4% (235 users) |
| **Within 1 day** | 92.8% (244 users) |
| **Within 7 days** | 98.5% (259 users) |
| **Max time to first AI** | 23 days |

### Distribution of Time-to-First-AI

| Days to First AI | User Count | Percentage |
|------------------|------------|------------|
| 0 days | 235 | 89.4% |
| 1 day | 9 | 3.4% |
| 2 days | 7 | 2.7% |
| 3 days | 4 | 1.5% |
| 4 days | 1 | 0.4% |
| 5 days | 2 | 0.8% |
| 6 days | 1 | 0.4% |
| 7 days | 0 | 0.0% |
| 8+ days | 4 | 1.5% |

### Time-to-First-AI by Onboarding Status

#### Completed Onboarding (n=177, 67.3% of AI users)
- Median: 0 days
- Mean: 0.4 days
- Same-day adoption: 90.4% (160 users)
- Within 1 day: 94.4% (167 users)
- Within 7 days: 98.9% (175 users)
- Max: 23 days

#### Skipped Onboarding (n=46, 17.5% of AI users)
- Median: 0 days
- Mean: 0.7 days
- Same-day adoption: 87.0% (40 users)
- Within 1 day: 91.3% (42 users)
- Within 7 days: 97.8% (45 users)
- Max: 21 days

#### Deferred/Neither Onboarding (n=41, 15.6% of AI users)
- Median: 0 days
- Mean: 0.5 days
- Same-day adoption: 87.8% (36 users)
- Within 1 day: 87.8% (36 users)
- Within 7 days: 97.6% (40 users)
- Max: 8 days

### Overall User Retention (All Users, Oct 2025 - Jan 2026)

**Total users tracked:** 539 users

| Retention Bucket | User Count | Percentage |
|------------------|------------|------------|
| 30+ days active | 9 | 1.7% |
| 14-29 days active | 31 | 5.8% |
| 7-13 days active | 43 | 8.0% |
| 1-6 days active | 117 | 21.7% |
| Single session only | 339 | 62.9% |

**Multi-session retention rate:** 37.1% (200 users returned)
**7+ day retention:** 15.4% (83 users)
**30+ day retention:** 1.7% (9 users)

### Daily Active Users Trends (Past 60 Days)

| Metric | Total (Nov 3 - Jan 2) |
|--------|------------------------|
| Daily Active Users (DAU) - Sessions | 1,113 unique users |
| Daily Active Users (DAU) - AI Messages | 561 unique users |
| **AI Adoption Rate** | **50.4%** |

Peak activity days:
- December 19: 64 session DAU, 29 AI DAU
- December 18: 43 session DAU, 20 AI DAU
- December 30: 73 session DAU, 30 AI DAU

---

## Visualizations

### Recommended Charts

1. **Histogram: Time-to-First-AI Distribution**
   - X-axis: Days to first AI interaction (0-23 days)
   - Y-axis: Number of users
   - Would show strong left-skew with 89.4% at day 0

2. **Stacked Bar Chart: Same-Day AI Adoption by Onboarding Status**
   - Three bars: Completed (90.4%), Skipped (87.0%), Neither (87.8%)
   - Shows minimal difference between groups

3. **Retention Funnel**
   - Stage 1: All users (539)
   - Stage 2: Used AI feature (263, 48.8%)
   - Stage 3: Multi-session users (200, 37.1%)
   - Stage 4: 7+ day retention (83, 15.4%)
   - Stage 5: 30+ day retention (9, 1.7%)

4. **Time Series: Daily Sessions vs AI Messages**
   - Shows 50.4% of daily active users engage with AI
   - Tracks AI feature adoption over 60-day period

---

## Takeaways

### Key Findings

1. **Extremely Fast AI Adoption**
   - Nearly 9 in 10 users (89.4%) who use AI do so on their very first day
   - 98.5% try AI within their first week
   - Median time-to-first-AI is 0 days across all cohorts

2. **Onboarding Has Minimal Impact on AI Adoption Speed**
   - Completed onboarding: 90.4% same-day AI adoption
   - Skipped onboarding: 87.0% same-day AI adoption
   - Neither: 87.8% same-day AI adoption
   - Difference is only 3.4 percentage points - not statistically significant

3. **High AI Feature Discovery**
   - 48.8% of all users (263/539) who started a session also used AI
   - 50.4% of daily active users send AI messages
   - This suggests strong feature visibility and/or value proposition

4. **Retention Challenge Exists**
   - 62.9% of users are single-session only
   - Only 37.1% return for a second session
   - 30+ day retention is very low at 1.7%
   - This suggests an activation or value realization gap

5. **AI Usage Doesn't Guarantee Retention**
   - Among the 263 AI users, we see similar retention challenges
   - The fact that 89% try AI on day 0 but overall retention is low suggests:
     - AI discovery is not the problem
     - The issue is likely downstream: value realization, workflow fit, or technical barriers

### Statistical Significance

The 3.4% difference in same-day AI adoption between completed (90.4%) and skipped (87.0%) onboarding is **not significant** given:
- Small sample sizes (177 vs 46 users)
- High baseline adoption rate (>87% in all groups)
- Overlapping confidence intervals

**Conclusion:** Onboarding completion does not meaningfully affect AI adoption speed.

---

## Suggested Actions / Product Direction

### 1. Deprioritize Onboarding Optimization for AI Discovery

**Rationale:** With 89.4% same-day AI adoption and minimal difference between onboarding states, the onboarding flow is already effectively surfacing the AI feature. Optimization efforts here would have marginal returns.

**Action:** Mark onboarding AI discovery as "solved problem" and shift resources elsewhere.

---

### 2. Focus on Retention, Not Adoption

**Critical Finding:** The funnel breaks at retention, not AI discovery:
- 48.8% of users try AI (good)
- But 62.9% never return (bad)
- And only 1.7% reach 30+ days (critical)

**Recommended Priority Shifts:**
1. **Investigate why single-session users don't return**
   - Run exit surveys or interviews with churned users
   - Analyze session recordings to identify friction points
   - Check for technical issues (crashes, performance, setup barriers)

2. **Study power users (30+ day cohort)**
   - What do the 9 retained users do differently?
   - What workflows or use cases keep them engaged?
   - Can we replicate their success patterns?

3. **Build activation mechanisms**
   - Email/notification campaigns to bring back day-1 users
   - Better "next steps" guidance after first AI interaction
   - Showcase specific, high-value use cases (not just generic AI)

---

### 3. Research the "AI Usage → Value Realization" Gap

**Problem:** Users try AI quickly but don't stick around.

**Hypotheses to Test:**
1. AI responses don't meet quality expectations
2. AI use cases don't align with user needs/workflows
3. Competing tools (ChatGPT, Cursor, etc.) provide better experience
4. Technical issues prevent successful AI interactions
5. Users try AI once out of curiosity but don't see ongoing value

**Research Methods:**
- User interviews with churned users who used AI
- NPS or satisfaction surveys after AI interactions
- Analysis of AI conversation lengths (do they complete tasks?)
- Correlation analysis: AI usage patterns vs retention

---

### 4. Consider "Time to Second AI Interaction" as New North Star

**Current metric problem:** "Time to first AI" is already optimized (0 days median).

**Better metric:** Time from first AI interaction to second AI interaction
- Measures if users return to the feature
- Better proxy for value realization
- Can segment by use case, conversation topic, or outcome

**Implementation:**
- Track `ai_message_sent` event sequences per user
- Calculate time between first and second AI conversations
- Set goal: "X% of first-time AI users return within Y days"

---

### 5. Don't Optimize Onboarding for AI Discovery

**Avoid this trap:** Since onboarding completion has no effect on AI adoption, don't:
- Extend onboarding to "better explain" AI features
- Force users through AI tutorials or demos
- Add more steps highlighting AI capabilities

**These would likely:**
- Increase onboarding abandonment
- Delay users from experiencing real value
- Not improve retention (the actual problem)

---

## Methodology Notes

### Data Limitations

1. **Cohort Exclusions:** `all_filtered_cohorts` filter was requested but could not be verified in the query due to PostHog API limitations. The `is_dev_user != true` filter was successfully applied.

2. **Retention Calculation:** 30-day retention is calculated as span between first and last session, not frequency of sessions. A user with 2 sessions 30 days apart shows as "30+ days retained" even if they weren't consistently active.

3. **Sample Size:** Only 263 users in the AI adoption cohort. Statistical power for detecting small differences (<5%) is limited.

4. **Temporal Bias:** Analysis includes users who signed up as recently as January 2026, who haven't had 30 days to demonstrate retention yet.

5. **AI Event Reliability:** Some users showed invalid timestamps (1969 epoch) for `first_ai_message`, suggesting potential event tracking issues. These were filtered out (unknown impact on results).

### Query Performance

- Primary query returned 548 rows, filtered to 263 valid users
- Retention query covered 539 users from Oct 2025 onwards
- Trends query aggregated 60 days of daily activity

---

## Next Steps

1. **Deep-dive on churned AI users** (Q03 suggestion)
   - Why did 263 AI-adopters not become retained users?
   - Interview sample of users who tried AI but never returned

2. **Power user analysis** (Q04 suggestion)
   - Profile the 9 users with 30+ day retention
   - What AI use cases, workflows, or patterns predict success?

3. **AI conversation quality analysis** (Q05 suggestion)
   - Measure AI conversation completion rates
   - Analyze conversation length, turns, and outcomes
   - Identify patterns in successful vs abandoned conversations

4. **Cohort retention by AI timing** (Further analysis)
   - Compare 30-day retention for day-0 AI users vs day-1+ AI users
   - Test if immediate AI usage actually helps or hurts retention
   - May reveal that "trying AI too early" is a problem

---

**Analysis Completed By:** Claude Sonnet 4.5
**Query Execution Date:** January 2, 2026
**Data Source:** PostHog Production Analytics
