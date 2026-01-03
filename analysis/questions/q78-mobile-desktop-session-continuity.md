# Q78: Mobile and Desktop Session Continuity

**Category:** Cross-Platform
**Priority:** High
**Scope:** Multi-Device Sync Analysis

## Question
Do users seamlessly continue sessions between mobile and desktop? What breaks continuity and causes friction?

## Business Context
Session continuity is critical for cross-platform adoption. Understanding friction points helps prioritize sync improvements and ensure seamless user experience.

## Required Events/Properties
- Session start/resume events
- Sync success/failure events
- Document state conflicts
- Platform (mobile/desktop)
- Offline/online status transitions
- Sync lag time

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Multi-device users
- Mobile app users
- Desktop app users
- Users with sync issues

## Analysis Approach
1. Track successful session continuity across platforms
2. Identify sync failures and conflict scenarios
3. Analyze session resume time across devices
4. Examine offline-to-online transition success
5. Correlate network conditions with sync issues

## Expected Insights
- Session continuity success rate
- Common sync failure scenarios
- Average sync lag between devices
- Impact of offline mode on continuity
- Friction points in cross-platform workflows

## PostHog Query Strategy
- Funnel: Edit on device A → Sync → Open on device B
- Trend analysis: Sync success/failure rates over time
- User paths: Cross-device session flows
- Property breakdown: Sync issues by network type, file size
- Time analysis: Sync lag distribution

## Success Metrics
- X% successful session continuity across platforms
- Average sync lag under Y seconds
- Z% of multi-device users report no sync issues
- Conflict resolution rate above N%

## Related Questions
- Q76: Session device handoff
- Q80: Offline mode effectiveness
- Q83: Sync bottlenecks

## Owner
TBD

## Status
Template - Ready for Implementation
