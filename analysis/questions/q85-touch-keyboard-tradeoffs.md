# Q85: Touch vs Keyboard Input Tradeoffs

**Category:** Mobile Experience
**Priority:** Medium
**Scope:** Mobile Input Method Analysis

## Question
How do mobile users balance touch gestures vs on-screen keyboard? What editing patterns emerge for each input method?

## Business Context
Understanding input method preferences helps optimize mobile editing UX and balance between gesture-based and keyboard-based workflows.

## Required Events/Properties
- Touch gesture events
- Keyboard activation events
- Input method switches
- Editing action types (formatting, selection, text entry)
- Keyboard vs gesture efficiency
- Error rates by input method

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Mobile app users
- Tablet users
- Active mobile editors

## Analysis Approach
1. Track input method usage patterns
2. Analyze task types by preferred input method
3. Measure efficiency and error rates for each method
4. Examine input method switching frequency
5. Identify optimal use cases for each input type

## Expected Insights
- Input method preferences by task type
- Gesture vs keyboard efficiency for common actions
- Common input method switching triggers
- Error rates and correction patterns by method
- Optimal input method for different editing scenarios

## PostHog Query Strategy
- Property breakdown: Input method by action type
- Sequential analysis: Input method switching patterns
- Funnel: Task completion by input method
- Event frequency: Error/correction by input method
- User segments: Input method preference profiles

## Success Metrics
- X% of actions use optimal input method
- Y% reduction in input method switches
- Z% task completion efficiency parity
- Error rate under N% for both methods

## Related Questions
- Q79: Touch input confidence
- Q84: Mobile feature adoption
- Q59: Mobile gesture usage

## Owner
TBD

## Status
Template - Ready for Implementation
