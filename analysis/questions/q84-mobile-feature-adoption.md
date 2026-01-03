# Q84: Mobile Feature Adoption vs Desktop

**Category:** Mobile Experience
**Priority:** High
**Scope:** Cross-Platform Feature Parity Analysis

## Question
Which features are adopted differently on mobile vs desktop? Are there mobile-specific engagement patterns?

## Business Context
Understanding feature adoption differences helps prioritize mobile-specific optimizations and identify features that may need mobile redesign.

## Required Events/Properties
- Feature usage events by platform
- Platform (mobile/desktop/web)
- Device type
- Feature discovery method
- Session duration by platform
- Task completion by platform

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Mobile app users
- Desktop app users
- Multi-platform users

## Analysis Approach
1. Compare feature adoption rates across platforms
2. Identify mobile-underutilized features
3. Analyze mobile-first vs desktop-first feature discovery
4. Examine task completion patterns by platform
5. Correlate screen size with feature adoption

## Expected Insights
- Features with low mobile adoption
- Mobile-preferred features
- Feature discovery barriers on mobile
- Task types suited for each platform
- Mobile UX improvements needed

## PostHog Query Strategy
- Property breakdown: Feature usage by platform
- Funnel: Feature discovery → Adoption by platform
- Retention: Feature usage by platform over time
- User paths: Mobile vs desktop workflows
- Correlation: Screen size vs feature adoption

## Success Metrics
- X% feature parity between mobile and desktop
- Y% mobile-specific feature adoption
- Z% task completion rate on mobile vs desktop
- Mobile engagement within N% of desktop

## Related Questions
- Q79: Touch input confidence
- Q85: Touch vs keyboard tradeoffs
- Q81: Platform switching workflows

## Owner
TBD

## Status
Template - Ready for Implementation
