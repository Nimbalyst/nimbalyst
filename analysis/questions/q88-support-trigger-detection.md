# Q88: Support Trigger Detection

**Category:** User Support
**Priority:** High
**Scope:** Support Need Analysis

## Question
What behaviors indicate users need help? Can we detect struggling users before they reach out or churn?

## Business Context
Proactive support detection enables timely intervention, reducing churn and improving user success. Identifying early warning signals helps optimize support resource allocation.

## Required Events/Properties
- Error encounters
- Repeated failed actions
- Feature abandonment
- Help documentation views
- Support ticket creation
- Session frustration signals (rapid undos, rage clicks)
- Time spent on failed tasks

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users who contacted support
- Users who churned
- New users in onboarding
- Power users vs beginners

## Analysis Approach
1. Identify behavioral patterns before support contact
2. Detect early warning signals of user struggle
3. Analyze feature abandonment triggers
4. Correlate frustration signals with churn
5. Build predictive model for support need

## Expected Insights
- Early warning indicators of user struggle
- Time between struggle signals and support contact
- Common paths to frustration and abandonment
- Preventable support scenarios
- Optimal intervention timing

## PostHog Query Strategy
- Sequential analysis: Events preceding support contact
- User paths: Struggle → Support/Churn workflows
- Funnel: Feature attempt → Failure → Retry → Abandon/Support
- Correlation: Frustration signals vs outcomes
- Predictive cohorts: High support need probability

## Success Metrics
- X% of struggling users identified before churn
- Y% reduction in reactive support with proactive intervention
- Z% success rate for proactive assistance
- Average N hours earlier detection vs support contact

## Related Questions
- Q89: Help documentation effectiveness
- Q91: In-app guidance timing
- Q93: Feedback after errors

## Owner
TBD

## Status
Template - Ready for Implementation
