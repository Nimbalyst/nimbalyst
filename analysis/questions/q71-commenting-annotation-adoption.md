# Q71: Commenting and Annotation Adoption

**Category:** Feature Engagement
**Priority:** Medium
**Scope:** Feature Usage Analysis

## Question
How many users are using commenting/annotation features on documents? What patterns emerge in collaborative markup?

## Business Context
Understanding collaborative markup usage helps validate the commenting feature and identify opportunities for enhancing collaborative workflows.

## Required Events/Properties
- Comment creation events
- Annotation events
- Reply to comment events
- Resolve comment events
- Document with comments properties

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Team users
- Commenting feature users

## Analysis Approach
1. Track commenting/annotation event frequency
2. Analyze comment threads and resolution patterns
3. Identify documents with high comment activity
4. Compare solo vs team commenting behavior
5. Examine temporal patterns in collaborative markup

## Expected Insights
- Commenting feature adoption rate
- Typical comment thread depth
- Resolution patterns and timing
- Documents that benefit most from comments
- Team collaboration patterns

## PostHog Query Strategy
- Trend analysis: Comment creation events over time
- Funnel: Create comment → Reply → Resolve
- User paths: Navigation patterns with commenting
- Property breakdown: Comments by document type/team size

## Success Metrics
- X% of team users actively comment
- Average Y comments per collaborative document
- Z% comment resolution rate within N days

## Related Questions
- Q72: Team approval workflow usage
- Q26: Collaboration feature adoption

## Owner
TBD

## Status
Template - Ready for Implementation
