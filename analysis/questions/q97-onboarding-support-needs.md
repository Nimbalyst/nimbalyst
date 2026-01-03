# Q97: Onboarding Support Needs

**Category:** User Onboarding
**Priority:** High
**Scope:** Early-Stage Support Analysis

## Question
What percentage of new users need support during onboarding? What early struggles predict support need or churn?

## Business Context
Early support needs indicate onboarding friction and predict long-term success. Understanding patterns helps optimize onboarding and proactively assist struggling users.

## Required Events/Properties
- Onboarding step events
- Support contact events
- Time to first support contact
- Support topic/issue
- Onboarding completion status
- User struggle signals (errors, repeated actions)
- Activation achievement

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- New user cohorts
- Users who contacted support during onboarding
- Users who completed vs abandoned onboarding
- Activated vs non-activated users

## Analysis Approach
1. Track support contact rates during onboarding
2. Identify early warning signals of struggle
3. Correlate support needs with onboarding steps
4. Analyze impact of early support on activation
5. Compare outcomes: supported vs unsupported users

## Expected Insights
- Percentage of new users needing onboarding support
- Common onboarding friction points
- Early struggle indicators predicting support need
- Impact of timely support on activation and retention
- Optimal proactive support triggers

## PostHog Query Strategy
- Funnel: Signup → Onboarding steps → Support/Activation
- Time to convert: Signup to first support contact
- Property breakdown: Support needs by onboarding step, user source
- Sequential analysis: Events preceding support contact
- Retention: Early-supported vs unsupported users

## Success Metrics
- X% of new users complete onboarding without support
- Y% activation rate with proactive support
- Z% reduction in early-stage churn with support
- Average support contact within N hours of signup

## Related Questions
- Q90: Tutorial completion funnel
- Q88: Support trigger detection
- Q3: Activation rate and time to activation
- Q91: In-app guidance timing

## Owner
TBD

## Status
Template - Ready for Implementation
