# Q92: Feature Announcement Effectiveness

**Category:** Product Communication
**Priority:** Medium
**Scope:** Feature Marketing Analysis

## Question
How effective are feature announcements at driving adoption? Which channels and formats work best?

## Business Context
Feature announcements are key to driving adoption of new capabilities. Understanding effectiveness helps optimize communication strategy and improve feature discovery.

## Required Events/Properties
- Announcement view events
- Announcement channel (in-app, email, blog)
- Announcement interaction (click, dismiss, try feature)
- Time from announcement to feature adoption
- Announcement format/variant
- User segment

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users who saw announcements
- Users who adopted announced features
- Users by engagement level

## Analysis Approach
1. Track announcement reach and engagement by channel
2. Measure feature adoption uplift from announcements
3. Analyze time-to-adoption after announcement
4. Compare effectiveness across user segments
5. Test announcement formats and timing

## Expected Insights
- Most effective announcement channels
- Optimal announcement timing and frequency
- Announcement format preferences by segment
- Impact on feature adoption speed
- Announcement fatigue patterns

## PostHog Query Strategy
- Funnel: View announcement → Click → Try feature → Adopt
- Time to convert: Announcement to feature adoption
- A/B test: Channel and format variations
- Property breakdown: Effectiveness by user segment, channel
- Retention: Announced feature usage over time

## Success Metrics
- X% announcement engagement rate
- Y% feature adoption lift from announcements
- Z% faster adoption with announcement
- Announcement-to-trial conversion above N%

## Related Questions
- Q91: In-app guidance timing
- Q25: Feature discovery pathways
- Q96: Social sharing and referrals

## Owner
TBD

## Status
Template - Ready for Implementation
