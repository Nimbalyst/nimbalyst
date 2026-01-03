# Q76: Session Device Handoff Patterns

**Category:** Cross-Platform
**Priority:** Medium
**Scope:** Multi-Device User Experience

## Question
How frequently do users hand off sessions between devices (desktop to mobile, mobile to desktop)? What triggers these transitions?

## Business Context
Understanding device handoff patterns validates cross-platform investment and identifies opportunities for seamless transition experiences.

## Required Events/Properties
- Session start events with device type
- Session resume events
- Document open events across devices
- Session continuity markers
- Time between device switches
- Platform (desktop/mobile/web)

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Multi-device users
- Mobile app users
- Desktop app users

## Analysis Approach
1. Identify users active on multiple platforms
2. Track sequential session patterns across devices
3. Analyze time gaps between device switches
4. Examine document continuity across platforms
5. Identify common handoff triggers (location, time of day)

## Expected Insights
- Multi-device usage prevalence
- Common device transition patterns
- Handoff friction points
- Context triggers for platform switching
- Session continuity success rate

## PostHog Query Strategy
- User paths: Cross-device session flows
- Sequential analysis: Platform switch patterns
- Time analysis: Handoff frequency and timing
- Funnel: Open on device A → Resume on device B
- Property breakdown: Handoffs by user segment

## Success Metrics
- X% of users active on multiple devices
- Average Y handoffs per week for multi-device users
- Z% successful session resume across devices
- Handoff completion time under N seconds

## Related Questions
- Q77: Enterprise provider consolidation
- Q78: Mobile and desktop session continuity
- Q80: Offline mode effectiveness

## Owner
TBD

## Status
Template - Ready for Implementation
