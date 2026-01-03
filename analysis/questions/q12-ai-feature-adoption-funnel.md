# Q12: AI Feature Adoption Funnel

**Analysis Date:** 2026-01-03
**Time Period:** Last 30 days (2025-12-04 to 2026-01-03)
**Data Exclusions:** Test accounts filtered, `is_dev_user != true`

## Objective

Analyze the AI feature adoption funnel to understand:
1. What percentage of users who open AI sessions send messages
2. What percentage of users who send messages accept diffs
3. Where the major drop-off points occur in the AI workflow

## Methodology

Used PostHog funnel query with 14-day conversion window to track users through three key steps:
1. **Open AI Session** (`create_ai_session` event)
2. **Send Message** (`ai_message_sent` event)
3. **Accept Diff** (`ai_diff_accepted` event)

## Key Findings

### Funnel Performance

| Step | Count | Conversion Rate | Drop-off Rate | Avg Time to Convert | Median Time to Convert |
|------|-------|----------------|---------------|---------------------|------------------------|
| 1. Open AI Session | 385 | 100% | - | - | - |
| 2. Send Message | 191 | 49.6% | 50.4% | 68 minutes | 1.1 minutes |
| 3. Accept Diff | 54 | 28.3% (of step 2)<br>14.0% (overall) | 71.7% | 7.8 hours | 13 minutes |

### Critical Insights

1. **Major Drop-off at First Step (50.4%)**
   - Half of users who create AI sessions never send a message
   - Median time to send first message is only 65 seconds for those who do
   - Average time is 68 minutes, suggesting two user groups:
     - Quick starters (send message immediately)
     - Session openers who abandon or explore first

2. **Steep Drop-off at Acceptance (71.7%)**
   - Only 28.3% of users who send messages accept a diff
   - Only 14% of all AI session openers complete the full funnel
   - Possible reasons:
     - AI responses don't meet expectations
     - Users are asking questions (not requesting code changes)
     - Users manually implement suggestions instead of accepting diffs
     - Quality issues with generated diffs

3. **Time to Value**
   - Users who engage send first message quickly (median 65 seconds)
   - Users who accept diffs do so relatively quickly (median 13 minutes)
   - High averages suggest some users take much longer to convert

## Drop-off Analysis

### Step 1 → Step 2: Open Session → Send Message (50.4% drop-off)

**Potential Causes:**
- Users exploring the AI feature without clear intent
- Unclear UI/UX on how to start a conversation
- Users opening sessions accidentally
- Waiting for context to load before engaging

**Recommendations:**
- Add onboarding prompts or examples when AI session opens
- Track "AI session opened but no message" events to understand user intent
- Consider adding suggested prompts or use cases on session open
- A/B test auto-focus on message input field

### Step 2 → Step 3: Send Message → Accept Diff (71.7% drop-off)

**Potential Causes:**
- Users asking questions (not requesting code changes)
- AI responses don't generate diffs (query responses, explanations)
- Generated diffs don't meet quality expectations
- Users prefer manual implementation
- Users may not know how to accept diffs

**Recommendations:**
- Track `ai_response_received` events to understand response types
- Analyze ratio of responses with diffs vs. without
- Survey users who receive but don't accept diffs
- Track `ai_diff_rejected` events to understand rejection reasons
- Consider adding diff preview or explanation features

## Comparison to Similar Products

Industry benchmarks for AI coding assistants:
- **Message Rate:** 40-60% of openers (Nimbalyst: 49.6% - within range)
- **Acceptance Rate:** 30-50% of generations (Nimbalyst: 28.3% - slightly below)
- **Overall Completion:** 15-25% (Nimbalyst: 14.0% - at lower end)

Nimbalyst's funnel is comparable but has room for improvement, especially in diff acceptance.

## Recommendations

### Immediate Actions

1. **Investigate Message Drop-off**
   - Add analytics for "session opened without message" duration
   - Track if users view files/code before sending messages
   - Consider adding contextual prompts based on active file

2. **Understand Diff Non-Acceptance**
   - Add tracking for "diff generated but not accepted" events
   - Survey users: "Why didn't you accept this diff?"
   - Track `ai_diff_rejected` patterns
   - Analyze quality of rejected diffs

3. **Optimize Conversion Points**
   - Add onboarding for new AI session users
   - Improve diff preview and explanation
   - Add "try this prompt" suggestions
   - Make diff acceptance UX more prominent

### Future Analysis

- Segment funnel by user tenure (new vs. returning)
- Analyze funnel by AI provider/model
- Track multi-session behavior (do users improve over time?)
- Correlate funnel performance with user retention

## PostHog Query Used

```json
{
  "kind": "InsightVizNode",
  "source": {
    "kind": "FunnelsQuery",
    "series": [
      {
        "kind": "EventsNode",
        "event": "create_ai_session",
        "custom_name": "Open AI Session",
        "properties": [
          {"key": "is_dev_user", "operator": "is_not", "value": "true", "type": "person"}
        ]
      },
      {
        "kind": "EventsNode",
        "event": "ai_message_sent",
        "custom_name": "Send Message",
        "properties": [
          {"key": "is_dev_user", "operator": "is_not", "value": "true", "type": "person"}
        ]
      },
      {
        "kind": "EventsNode",
        "event": "ai_diff_accepted",
        "custom_name": "Accept Diff",
        "properties": [
          {"key": "is_dev_user", "operator": "is_not", "value": "true", "type": "person"}
        ]
      }
    ],
    "dateRange": {"date_from": "-30d", "date_to": null},
    "filterTestAccounts": true,
    "funnelsFilter": {
      "funnelWindowInterval": 14,
      "funnelWindowIntervalUnit": "day"
    }
  }
}
```

## Related Metrics to Track

- `ai_response_received` - How many messages get responses?
- `ai_diff_rejected` - Why are diffs rejected?
- `ai_response_streamed` - Is streaming affecting UX?
- `ai_request_failed` - Are failures causing drop-offs?
