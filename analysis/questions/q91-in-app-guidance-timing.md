# Q91: In-App Guidance Timing and Effectiveness

**Category:** User Support
**Priority:** Medium
**Scope:** Contextual Help Analysis

## Question
When do users engage with in-app guidance (tooltips, hints, contextual help)? Is timing and placement effective?

## Business Context
Contextual guidance can reduce friction and improve feature discovery without interrupting flow. Understanding engagement patterns helps optimize when and how to present help.

## Required Events/Properties
- Tooltip/hint display events
- Tooltip interaction (view, dismiss, act on)
- Contextual help trigger
- User state when guidance shown
- Guidance effectiveness (action completion)
- Guidance dismissal patterns

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- New users vs experienced users
- Users by feature adoption level
- Users who dismiss vs engage with guidance

## Analysis Approach
1. Track guidance display and interaction rates
2. Analyze optimal timing for different guidance types
3. Measure effectiveness by user state and context
4. Identify over-shown vs under-utilized guidance
5. Correlate guidance engagement with feature adoption

## Expected Insights
- Optimal timing for different guidance types
- Most/least effective guidance placements
- User segments benefiting most from guidance
- Guidance fatigue patterns
- Impact on feature discovery and adoption

## PostHog Query Strategy
- Funnel: Guidance shown → Engaged → Action completed
- Property breakdown: Guidance effectiveness by context, user segment
- Trend analysis: Guidance interaction over user lifetime
- A/B test: Timing and placement variations
- User paths: Guidance-influenced workflows

## Success Metrics
- X% guidance engagement rate
- Y% feature adoption lift with guidance
- Z% of new users complete guided actions
- Guidance dismissal rate under N%

## Related Questions
- Q90: Tutorial completion funnel
- Q92: Feature announcement effectiveness
- Q88: Support trigger detection

## Owner
TBD

## Status
Template - Ready for Implementation
