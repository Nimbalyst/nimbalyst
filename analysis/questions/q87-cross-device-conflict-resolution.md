# Q87: Cross-Device Conflict Resolution

**Category:** Cross-Platform
**Priority:** High
**Scope:** Sync Conflict Analysis

## Question
How do users handle conflicts when editing the same document across devices? What conflict patterns emerge?

## Business Context
Conflict resolution quality directly impacts user trust and collaboration success. Understanding patterns helps improve conflict prevention and resolution UX.

## Required Events/Properties
- Conflict detection events
- Conflict resolution events
- Resolution strategy (accept theirs/mine/merge)
- Platform where conflict occurred
- Time between conflicting edits
- Document type
- User experience with conflicts

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Multi-device users
- Users who encountered conflicts
- Collaborative editing users

## Analysis Approach
1. Track conflict occurrence frequency and patterns
2. Analyze resolution strategies and success rates
3. Identify scenarios most prone to conflicts
4. Examine user behavior after conflict encounters
5. Measure impact of conflicts on user satisfaction

## Expected Insights
- Conflict occurrence rate for multi-device users
- Common conflict scenarios and triggers
- Effective vs problematic resolution strategies
- User confidence in conflict resolution
- Impact on collaboration and retention

## PostHog Query Strategy
- Trend analysis: Conflict rates over time
- Property breakdown: Conflicts by document type, edit frequency
- Funnel: Conflict detection → Resolution → Continued usage
- User paths: Post-conflict behavior
- Retention: Users who encounter conflicts vs those who don't

## Success Metrics
- Conflict rate under X per Y multi-device sessions
- Z% successful conflict resolution (no data loss)
- N% user satisfaction with conflict handling
- Conflict resolution time under A minutes

## Related Questions
- Q78: Mobile and desktop session continuity
- Q83: Sync bottlenecks
- Q80: Offline mode effectiveness

## Owner
TBD

## Status
Template - Ready for Implementation
