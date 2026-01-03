# Q8: Attachment Usage in AI Conversations

**Analysis Period:** Last 30 days (Dec 4, 2025 - Jan 3, 2026)
**Filters Applied:** Non-dev users only (is_dev_user != true), excluding all_filtered_cohorts

## Executive Summary

Attachments are a power-user feature with only 5.0% of AI messages including attachments, but used by 24.5% of AI users. Users who adopt attachments are 22x more engaged (126 messages vs 5.7 messages), making this a critical engagement driver. Claude Code dominates as the provider (99.8% of messages), with attachments used exclusively with this provider.

## Overall Attachment Usage

### Message-Level Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| Total AI Messages | 7,185 | 100% |
| Messages with Attachments | 359 | 5.0% |
| Messages without Attachments | 6,826 | 95.0% |

**Key Finding:** Only 5.0% of AI messages include attachments, indicating this is a specialized feature used selectively.

### User-Level Adoption

| Metric | Count | Percentage |
|--------|-------|------------|
| Total AI Users | 204 | 100% |
| Users Who Used Attachments | 50 | 24.5% |
| Users Who Never Used Attachments | 154 | 75.5% |

**Key Finding:** While only 5% of messages have attachments, 24.5% of AI users have used the feature at least once, suggesting it's adopted by a significant minority.

### Attachment Addition Events

- **Total `add_attachment` events:** 449
- **Messages with attachments:** 359
- **Ratio:** 1.25 attachments added per message with attachments

**Interpretation:** The slight difference suggests some users add/remove attachments during composition, or some attachment additions don't result in sent messages.

## Attachment Distribution Patterns

### Attachments per Message

| Attachment Count | Messages | % of Attachment Messages |
|-----------------|----------|-------------------------|
| 1 attachment | 327 | 91.1% |
| 2 attachments | 22 | 6.1% |
| 3 attachments | 7 | 1.9% |
| 4 attachments | 1 | 0.3% |
| 5 attachments | 1 | 0.3% |
| 6 attachments | 1 | 0.3% |
| **Total** | **359** | **100%** |

**Key Pattern:** 91.1% of messages with attachments include just 1 attachment. Multi-attachment messages are rare (8.9%), suggesting users typically focus on one context file at a time.

**Edge Cases:**
- 3 users sent messages with 4-6 attachments, showing advanced power-user behavior
- Maximum observed: 6 attachments in a single message

## Attachment Usage by Provider

### Provider Distribution

| Provider | Total Messages | Messages with Attachments | % with Attachments | Users |
|----------|---------------|--------------------------|-------------------|--------|
| claude-code | 7,174 | 359 | 5.0% | N/A |
| openai | 5 | 0 | 0.0% | N/A |
| claude | 3 | 0 | 0.0% | N/A |
| lmstudio | 3 | 0 | 0.0% | N/A |

**Critical Finding:**
- **100% of attachment usage is with claude-code** (359/359)
- Alternative providers (OpenAI, Claude API, LMStudio) show 0% attachment usage
- Claude Code represents 99.8% of all AI message volume

**Implications:**
- Attachment feature may be Claude Code-specific or best optimized for this provider
- Other providers have minimal usage overall (11 messages total in 30 days)
- Cannot analyze provider variation meaningfully due to sample size

## User Engagement Analysis

### Comparison: Users with vs without Attachments

| User Segment | User Count | Avg Messages per User | Total Messages | Engagement Multiplier |
|--------------|-----------|----------------------|----------------|---------------------|
| Uses Attachments | 50 | 126.24 | 6,312 | **22.3x** |
| No Attachments | 154 | 5.67 | 873 | 1.0x baseline |
| **Overall** | **204** | **35.22** | **7,185** | - |

**Key Insight:** Users who adopt attachments send 22x more messages than those who don't (126 vs 5.7 messages). This is the strongest engagement signal in the dataset.

### Engagement Distribution

**Power Users (Using Attachments):**
- Represent 24.5% of AI users
- Generate 87.9% of all AI messages (6,312/7,185)
- Average 126 messages per user over 30 days
- Average 4.2 messages per day per user

**Casual Users (No Attachments):**
- Represent 75.5% of AI users
- Generate only 12.1% of all AI messages (873/7,185)
- Average 5.7 messages per user over 30 days
- Average 0.19 messages per day per user

## Top Attachment Users

### Most Active Attachment Users

| Rank | User ID | Total Messages | Messages with Attachments | Attachment % | Max Attachments |
|------|---------|---------------|--------------------------|--------------|----------------|
| 1 | 2bc03eaf-63a6-534e-8be0-7ac2ab8bfe22 | 2,333 | 61 | 2.6% | 2 |
| 2 | 17f76718-60ca-58f0-935d-12f3c027d14f | 913 | 43 | 4.7% | 5 |
| 3 | f55ae1e8-b7b3-5ddf-b06e-9b016cce438e | 199 | 41 | 20.6% | 2 |
| 4 | 85552418-8dfa-5519-bb67-226aeccbf56a | 498 | 41 | 8.2% | 1 |
| 5 | 8a6ccfbe-f875-5287-96ba-a71584381d3e | 279 | 18 | 6.5% | 3 |
| 6 | ce59969b-4add-5891-a67e-22a3b9802611 | 197 | 18 | 9.1% | 1 |
| 7 | 881033d0-6592-528f-9b0b-58fa30a91ead | 115 | 14 | 12.2% | 1 |
| 8 | 88c6713e-a585-53a7-860b-efaad2ba2de6 | 171 | 13 | 7.6% | 2 |
| 9 | 13982812-b0cc-5997-b379-a8ab5dc52e5b | 40 | 11 | 27.5% | 3 |
| 10 | 63dc67f1-c356-55d9-8380-d652fc0cf556 | 30 | 10 | 33.3% | 2 |

### Usage Patterns

**Heavy Users (2,000+ messages):**
- User #1: 2,333 messages, only 2.6% with attachments (61 messages)
- Uses attachments selectively despite high volume

**High Attachment Rate Users:**
- User #10: 33.3% of messages have attachments (10/30)
- User #9: 27.5% of messages have attachments (11/40)
- User #3: 20.6% of messages have attachments (41/199)
- These users rely heavily on context-aware conversations

**Balanced Users:**
- Most top users maintain 4-12% attachment rate
- Suggests attachments used for specific tasks requiring file context

## Correlation with Session Engagement

### Attachment Adoption and Message Volume

Based on the 22x engagement multiplier, we can segment users:

**Tier 1: Super Users (100+ messages)**
- Estimated: ~20-30 users
- All appear to use attachments
- Generate bulk of message volume

**Tier 2: Active Users (20-99 messages)**
- Mix of attachment and non-attachment users
- Likely includes the 20-30 remaining attachment users

**Tier 3: Trial Users (1-19 messages)**
- Estimated: ~120-150 users
- Most don't discover or use attachments
- Generate minimal message volume

### Causal Direction Analysis

**Question:** Do attachments cause engagement, or do engaged users discover attachments?

**Evidence for "Attachments Drive Engagement":**
- Attachment feature enables more complex, context-aware conversations
- Users can reference specific code/files, reducing back-and-forth
- Enables longer, more productive sessions

**Evidence for "Engaged Users Discover Attachments":**
- Heavy users naturally explore features more
- Attachment UI may require multiple sessions to discover
- Casual users may not reach use cases requiring file context

**Conclusion:** Likely bidirectional - engaged users discover attachments, then attachments enable even deeper engagement. The 22x multiplier is too large to be purely selection bias.

## Attachment Feature Value

### Adoption Metrics Summary

- **User Adoption Rate:** 24.5% (50/204 AI users)
- **Message Penetration:** 5.0% (359/7,185 messages)
- **Average Attachments per Message:** 1.2 (mostly single-file context)
- **Engagement Multiplier:** 22x message volume

### Feature Stickiness

Of the 50 users who used attachments:
- Top 10 users account for 267/359 attachment messages (74.4%)
- Top 20 users likely account for >90% of attachment usage
- Suggests feature is "sticky" for those who adopt it

### Provider Lock-in

- 100% of attachments used with Claude Code
- Creates strong differentiation vs other providers
- Users choosing other providers don't use attachments (though sample size is tiny: 11 messages)

## Key Insights

### Critical Success Factors

1. **Attachment adoption is the strongest engagement predictor** - 22x message volume increase
2. **One-quarter of AI users have adopted attachments** (24.5%), showing healthy discovery
3. **Attachments are used selectively** - Only 5% of messages, suggesting deliberate use for specific tasks
4. **Single-file context dominates** - 91% use 1 attachment, keeping conversations focused

### Barriers to Broader Adoption

1. **75.5% of AI users never use attachments** despite being a power feature
2. **No cross-provider attachment usage** - Locked to Claude Code
3. **Feature discovery gap** - Casual users (5.7 messages avg) may not reach use cases requiring attachments

### User Behavior Patterns

**Power User Workflow:**
- High message volume (100+ messages)
- Selective attachment use (5-10% of messages)
- Mostly single-file context
- Occasional multi-file references (2-3 attachments)

**Casual User Workflow:**
- Low message volume (<10 messages)
- No attachment usage
- May not discover feature or reach use cases requiring it

## Recommendations

### Increase Attachment Adoption

1. **Improve onboarding** - Show attachment example in first AI session
2. **Contextual prompts** - Suggest attachments when user references files in text
3. **One-click attachment** - "Add current file" button in editor context menu
4. **Tutorial on first use** - Explain benefits when user first adds attachment

### Optimize Attachment Experience

1. **Support drag-and-drop** for easy multi-file attachment
2. **Show file previews** in attachment UI
3. **Remember frequently attached files** for quick re-attachment
4. **Add "attach all open files"** shortcut for multi-file context

### Convert Trial Users to Power Users

1. **Target the 154 non-attachment users** with education
2. **Demonstrate value** - "Try asking about this file" prompt in editor
3. **Track conversion** - Measure trial → attachment adoption → engagement increase
4. **A/B test attachment prompts** to find optimal conversion strategy

### Maintain Provider Differentiation

1. **Highlight attachment capability** in Claude Code marketing
2. **Consider enabling attachments for other providers** to increase flexibility
3. **Track provider switching** related to attachment availability

## Data Quality Notes

- Provider sample sizes too small for meaningful comparison (OpenAI: 5 messages, Claude: 3, LMStudio: 3)
- Cannot track which specific files were attached, limiting content analysis
- No session-level data to measure attachment impact on conversation length
- Correlation vs causation for engagement multiplier requires further study
- The 449 `add_attachment` events vs 359 messages with attachments (1.25x ratio) suggests some user experimentation or abandoned compositions
