# Q74: Sharing with CollabV3 Adoption

**Category:** Feature Engagement
**Priority:** High
**Scope:** Collaboration Analysis

## Question
How many users are sharing documents using CollabV3? What sharing patterns and collaboration behaviors emerge?

## Business Context
CollabV3 is the core collaboration technology. Understanding sharing adoption and patterns validates the architecture and identifies opportunities for viral growth.

## Required Events/Properties
- Document share created (CollabV3)
- Share link accessed
- Collaborative edit session started
- Real-time collaborator count
- Share permission levels
- Share link expiration settings

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- CollabV3 enabled users
- Team workspace users
- Share link creators
- Share link recipients

## Analysis Approach
1. Track share creation and access frequency
2. Analyze share link virality (shares per user, recipients per share)
3. Examine collaboration session patterns (duration, participant count)
4. Compare permission level usage (view/edit/admin)
5. Correlate sharing with user activation and retention

## Expected Insights
- Share adoption rate among users
- Average collaborators per shared document
- Share link virality coefficient
- Permission preference patterns
- Impact of sharing on retention and engagement

## PostHog Query Strategy
- Trend analysis: Share creation over time
- Funnel: Create share → Access link → Collaborative edit
- User paths: Sharing discovery and adoption journey
- Property breakdown: Shares by permission level, team size
- Retention: Share creators vs non-sharers

## Success Metrics
- X% of active users create shares
- Average Y recipients per share link
- Z% of recipients become active users
- Share creators have N% higher retention

## Related Questions
- Q26: Collaboration feature adoption
- Q73: Enterprise feature stacking
- Q75: Permission grants in enterprise

## Owner
TBD

## Status
Template - Ready for Implementation
