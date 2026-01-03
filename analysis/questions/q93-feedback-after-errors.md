# Q93: Feedback Collection After Errors

**Category:** User Support
**Priority:** Medium
**Scope:** Error Recovery and Feedback Analysis

## Question
Do users provide feedback after encountering errors? What feedback quality and sentiment patterns emerge?

## Business Context
Post-error feedback provides valuable insights for debugging and improvement. Understanding feedback patterns helps prioritize fixes and improve error recovery UX.

## Required Events/Properties
- Error occurrence events
- Feedback prompt display
- Feedback submission events
- Feedback content and sentiment
- Error type and severity
- Time from error to feedback
- User frustration level

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users who encountered errors
- Users who provided feedback
- Users by error frequency

## Analysis Approach
1. Track error-to-feedback conversion rates
2. Analyze feedback quality and actionability
3. Correlate error types with feedback likelihood
4. Examine sentiment by error severity
5. Measure impact of feedback on issue resolution

## Expected Insights
- Error types most likely to generate feedback
- Feedback quality by error severity
- Optimal timing for feedback prompts
- User sentiment patterns after errors
- Impact of error recovery on feedback sentiment

## PostHog Query Strategy
- Funnel: Error → Prompt → Feedback submission
- Property breakdown: Feedback rate by error type, severity
- Sentiment analysis: Feedback content by error category
- Time analysis: Error to feedback timing
- Retention: Users who provide feedback vs those who don't

## Success Metrics
- X% feedback submission rate after errors
- Y% of feedback is actionable
- Z% positive sentiment with good error recovery
- Average feedback submission within N minutes of error

## Related Questions
- Q88: Support trigger detection
- Q94: Bug report quality and completeness
- Q54: Error recovery patterns

## Owner
TBD

## Status
Template - Ready for Implementation
