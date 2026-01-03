# Q95: Community Engagement Patterns

**Category:** Community Growth
**Priority:** Low
**Scope:** User Community Analysis

## Question
Are users engaging with community forums, discussions, or user groups? What drives community participation?

## Business Context
Active communities drive engagement, support, and word-of-mouth growth. Understanding participation patterns helps foster vibrant user communities.

## Required Events/Properties
- Forum/discussion view events
- Post/comment creation
- Upvote/reaction events
- Question ask/answer events
- Community feature usage
- User role in community (lurker/contributor/moderator)

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Community members
- Active contributors
- Lurkers (viewers only)
- Power users

## Analysis Approach
1. Track community participation rates and patterns
2. Analyze lurker-to-contributor conversion
3. Identify topics driving engagement
4. Examine power user characteristics
5. Correlate community participation with product engagement

## Expected Insights
- Community participation rate
- Lurker vs contributor behavior patterns
- Topics and content driving engagement
- Path from lurker to active contributor
- Impact of community on retention and advocacy

## PostHog Query Strategy
- Funnel: View → Engage → Contribute → Power user
- Property breakdown: Participation by user segment, topic
- Retention: Community participants vs non-participants
- User paths: Community engagement journey
- Trend analysis: Community growth over time

## Success Metrics
- X% of users visit community
- Y% lurker-to-contributor conversion
- Z% of active users engage with community
- Community participants have N% higher retention

## Related Questions
- Q96: Social sharing and referrals
- Q97: Onboarding support needs
- Q89: Help documentation effectiveness

## Owner
TBD

## Status
Template - Ready for Implementation
