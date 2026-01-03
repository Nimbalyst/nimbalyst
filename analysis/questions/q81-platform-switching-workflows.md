# Q81: Platform Switching Workflows

**Category:** Cross-Platform
**Priority:** Medium
**Scope:** Multi-Platform Behavior Analysis

## Question
What workflows drive users to switch between desktop, mobile, and web? Are switches intentional or driven by necessity?

## Business Context
Understanding platform switching motivations helps optimize each platform's strengths and identify opportunities for better platform-specific experiences.

## Required Events/Properties
- Session start events by platform
- Feature usage by platform
- Document type accessed by platform
- Time of day and location context
- Task completion by platform
- Platform preference settings

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Multi-platform users
- Mobile app users
- Desktop app users
- Web users

## Analysis Approach
1. Identify multi-platform users and their switching patterns
2. Analyze task types performed on each platform
3. Examine temporal and contextual switching triggers
4. Compare feature usage across platforms
5. Identify platform-specific workflows

## Expected Insights
- Common platform switching triggers
- Platform preference by task type
- Mobile-first vs desktop-first workflows
- Time-of-day platform usage patterns
- Context-driven platform choices

## PostHog Query Strategy
- User paths: Cross-platform workflow sequences
- Property breakdown: Platform usage by task type, time of day
- Sequential analysis: Platform switching patterns
- Correlation: Context variables vs platform choice
- User segments: Platform usage profiles

## Success Metrics
- X% of users active on multiple platforms
- Y% task completion rate per platform
- Z% intentional platform switches (vs necessity)
- Platform satisfaction scores above N

## Related Questions
- Q76: Session device handoff
- Q78: Mobile and desktop session continuity
- Q82: Responsive design engagement

## Owner
TBD

## Status
Template - Ready for Implementation
