# Q80: Offline Mode Effectiveness

**Category:** Cross-Platform
**Priority:** High
**Scope:** Offline Capability Analysis

## Question
How effective is offline mode? Do users successfully work offline and sync changes when reconnecting?

## Business Context
Offline capability is a key differentiator for mobile and remote work scenarios. Understanding effectiveness helps prioritize sync improvements and validate offline investment.

## Required Events/Properties
- Offline mode activation
- Offline edit events
- Sync on reconnection events
- Sync success/failure after offline
- Conflict resolution events
- Offline duration
- Network status transitions

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Mobile app users
- Users who go offline
- Remote/traveling users

## Analysis Approach
1. Track offline mode usage frequency and duration
2. Analyze sync success rates after offline periods
3. Examine conflict occurrence and resolution
4. Identify scenarios causing sync failures
5. Compare offline editing patterns across platforms

## Expected Insights
- Offline mode adoption and usage patterns
- Sync success rate after reconnection
- Common conflict scenarios
- Offline editing productivity vs online
- Impact of offline duration on sync success

## PostHog Query Strategy
- Trend analysis: Offline mode usage over time
- Funnel: Go offline → Edit → Reconnect → Sync success
- Property breakdown: Sync success by offline duration, edit volume
- Time analysis: Offline period distribution
- Retention: Offline users vs online-only users

## Success Metrics
- X% successful sync after offline editing
- Conflict rate under Y% for offline sessions
- Z% of offline edits sync within N seconds
- Offline users have similar retention to online users

## Related Questions
- Q78: Mobile and desktop session continuity
- Q83: Sync bottlenecks
- Q81: Platform switching workflows

## Owner
TBD

## Status
Template - Ready for Implementation
