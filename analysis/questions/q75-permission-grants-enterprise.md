# Q75: Permission Grants in Enterprise Environments

**Category:** Feature Engagement
**Priority:** Medium
**Scope:** Enterprise Security Analysis

## Question
How are enterprise teams using granular permission controls? What permission patterns emerge across different team structures?

## Business Context
Advanced permission controls are a key enterprise differentiator. Understanding usage patterns validates the permission model and identifies opportunities for simplification or enhancement.

## Required Events/Properties
- Permission grant/revoke events
- Role assignment events
- Access control changes
- Permission level (view/edit/admin/custom)
- Resource type (document/folder/workspace)
- Team hierarchy properties

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Enterprise tier users
- Team admins
- Users with custom permission roles

## Analysis Approach
1. Track permission change frequency and patterns
2. Analyze permission models by team size/structure
3. Identify common permission templates/patterns
4. Examine permission conflicts or escalations
5. Correlate permission complexity with team satisfaction

## Expected Insights
- Permission management adoption rate
- Common permission level distributions
- Custom role usage patterns
- Permission model complexity by team size
- Impact of permissions on collaboration velocity

## PostHog Query Strategy
- Trend analysis: Permission changes over time
- User segments: By permission model complexity
- Property breakdown: Permissions by team size, industry
- Correlation: Permission usage vs collaboration metrics

## Success Metrics
- X% of enterprise teams use custom roles
- Average Y permission levels per team
- Z% of teams use folder-level permissions
- Permission setup completed within N days

## Related Questions
- Q73: Enterprise feature stacking
- Q74: Sharing with CollabV3
- Q39: Premium tier usage patterns

## Owner
TBD

## Status
Template - Ready for Implementation
