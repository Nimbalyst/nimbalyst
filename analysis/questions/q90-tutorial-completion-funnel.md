# Q90: Tutorial and Onboarding Completion Funnel

**Category:** User Onboarding
**Priority:** High
**Scope:** Onboarding Effectiveness Analysis

## Question
Where do users drop off in tutorials and onboarding flows? What completion rates indicate effective onboarding?

## Business Context
Onboarding completion directly impacts activation and long-term retention. Understanding dropoff points helps optimize the onboarding experience and improve user success.

## Required Events/Properties
- Tutorial start/complete events
- Onboarding step progression
- Step completion time
- Tutorial skip/abandon events
- Post-onboarding activation
- Tutorial version/variant

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- New user cohorts
- Users by acquisition channel
- Tutorial completers vs non-completers

## Analysis Approach
1. Map complete onboarding funnel and identify dropoff points
2. Analyze completion rates by user segment
3. Examine time-to-complete for each step
4. Correlate completion with activation and retention
5. Test tutorial variations and measure impact

## Expected Insights
- Onboarding funnel conversion rates
- Highest friction steps
- Optimal tutorial length and complexity
- Impact of completion on activation
- Segment-specific onboarding needs

## PostHog Query Strategy
- Funnel: Onboarding step-by-step conversion
- Time to convert: Per-step duration analysis
- Retention: Tutorial completers vs non-completers
- A/B test: Tutorial variations
- User paths: Alternative onboarding routes

## Success Metrics
- X% tutorial completion rate
- Y% activation rate for completers vs non-completers
- Z% retention lift for tutorial completers
- Average completion time under N minutes

## Related Questions
- Q3: Activation rate and time to activation
- Q89: Help documentation effectiveness
- Q91: In-app guidance timing

## Owner
TBD

## Status
Template - Ready for Implementation
