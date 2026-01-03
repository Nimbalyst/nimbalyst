# Q96: Social Sharing and Referral Patterns

**Category:** Growth
**Priority:** Medium
**Scope:** Viral Growth Analysis

## Question
Do users share Nimbalyst socially or refer others? What sharing patterns drive new user acquisition?

## Business Context
Social sharing and referrals are low-cost, high-quality acquisition channels. Understanding sharing behavior helps optimize viral growth loops.

## Required Events/Properties
- Social share events
- Share channel (Twitter, LinkedIn, email, etc.)
- Share content type (document, feature, achievement)
- Referral link creation/usage
- Referred user conversion
- Share trigger/context

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users who shared
- Users who referred others
- Referred users
- Power users and advocates

## Analysis Approach
1. Track social sharing frequency and channels
2. Analyze share-to-conversion funnel
3. Identify high-sharing user characteristics
4. Examine content that drives shares
5. Calculate referral loop strength and virality coefficient

## Expected Insights
- Sharing frequency and preferred channels
- Share-to-acquisition conversion rate
- User segments most likely to share
- Content types driving shares
- Viral coefficient and k-factor

## PostHog Query Strategy
- Funnel: Create share → Share posted → Recipient clicks → Signup
- Property breakdown: Shares by channel, content type, user segment
- Trend analysis: Sharing over time and user lifecycle
- Cohort analysis: Referred vs organic user quality
- Viral coefficient: Users referred per user

## Success Metrics
- X% of active users share/refer
- Y% conversion rate for referred users
- Viral coefficient (k-factor) of Z
- Average N referrals per sharing user

## Related Questions
- Q95: Community engagement patterns
- Q92: Feature announcement effectiveness
- Q1: User acquisition channels

## Owner
TBD

## Status
Template - Ready for Implementation
