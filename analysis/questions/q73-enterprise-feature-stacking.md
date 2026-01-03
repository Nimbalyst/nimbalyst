# Q73: Enterprise Feature Stacking

**Category:** Product Strategy
**Priority:** High
**Scope:** Enterprise Feature Analysis

## Question
Which enterprise features are most commonly used together? What feature combinations indicate high-value enterprise usage?

## Business Context
Understanding feature stacking patterns helps identify the most valuable enterprise feature bundles and informs pricing/packaging strategy.

## Required Events/Properties
- All enterprise feature usage events
- Team management events
- Advanced permissions events
- SSO/authentication events
- Audit log access
- Priority support usage
- Advanced sync features
- Approval workflows
- Custom branding usage

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Enterprise tier subscribers
- Team admins
- High-value accounts

## Analysis Approach
1. Identify all enterprise feature usage per account
2. Calculate feature co-occurrence patterns
3. Cluster accounts by feature usage profiles
4. Analyze progression from basic to advanced features
5. Correlate feature stacks with retention/expansion

## Expected Insights
- Most common enterprise feature combinations
- Feature adoption sequences
- "Sticky" feature combinations
- Underutilized enterprise features
- Feature bundles that predict account expansion

## PostHog Query Strategy
- Correlation analysis: Feature usage patterns
- User segments: Cluster by feature combination
- Sequential analysis: Feature adoption order
- Retention cohorts: By feature stack

## Success Metrics
- X% of enterprise users adopt Y+ features
- Feature combination Z predicts N% higher retention
- Average enterprise account uses A features

## Related Questions
- Q39: Premium tier usage patterns
- Q72: Team approval workflows
- Q74: Sharing with CollabV3

## Owner
TBD

## Status
Template - Ready for Implementation
