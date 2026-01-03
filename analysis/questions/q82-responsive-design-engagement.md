# Q82: Responsive Design Engagement

**Category:** User Experience
**Priority:** Medium
**Scope:** Cross-Device UI Analysis

## Question
Does responsive design effectively serve different screen sizes? Do users engage equally across form factors?

## Business Context
Responsive design effectiveness validates UI investment and identifies form factor-specific optimization opportunities.

## Required Events/Properties
- Screen size/resolution
- Viewport dimensions
- Device type (phone/tablet/desktop)
- UI component interactions by screen size
- Feature discoverability by form factor
- Session duration by screen size

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users by device type (phone/tablet/desktop)
- Users by screen size categories
- Mobile app vs web users

## Analysis Approach
1. Analyze engagement metrics by screen size
2. Compare feature usage across form factors
3. Identify UI elements with low engagement on small screens
4. Examine navigation patterns by device type
5. Assess feature discoverability across screen sizes

## Expected Insights
- Engagement parity across screen sizes
- Features underutilized on small screens
- UI components with form factor issues
- Navigation efficiency by device type
- Screen size impact on feature adoption

## PostHog Query Strategy
- Property breakdown: Engagement by screen size, device type
- Trend analysis: Feature usage by form factor over time
- Funnel: Feature discovery by screen size
- Heatmap: UI interaction patterns by device type
- Retention: Users by primary device type

## Success Metrics
- X% engagement parity across form factors
- Y% feature discoverability on mobile screens
- Z% of features equally usable on all screen sizes
- Session quality similar across device types

## Related Questions
- Q81: Platform switching workflows
- Q86: File form factor optimization
- Q59: Mobile gesture usage

## Owner
TBD

## Status
Template - Ready for Implementation
