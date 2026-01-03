# Q89: Help Documentation Effectiveness

**Category:** User Support
**Priority:** Medium
**Scope:** Self-Service Support Analysis

## Question
Which help articles are most useful? Do users find answers or escalate to support?

## Business Context
Effective documentation reduces support burden and improves user autonomy. Understanding documentation usage helps optimize content and identify gaps.

## Required Events/Properties
- Help article views
- Article search queries
- Time spent on articles
- Article usefulness ratings
- Post-article behavior (resolved vs support contact)
- Failed search queries
- Article bounce rate

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users who viewed help documentation
- Users who contacted support
- New users vs experienced users

## Analysis Approach
1. Track help article engagement and effectiveness
2. Analyze search patterns and content gaps
3. Measure self-service success vs support escalation
4. Identify high-value vs low-value content
5. Correlate documentation quality with user success

## Expected Insights
- Most/least effective help articles
- Common documentation gaps
- Self-service resolution rate
- Search patterns indicating user needs
- Impact of documentation on support volume

## PostHog Query Strategy
- Trend analysis: Help article views over time
- Funnel: Problem → Search → View article → Resolve/Escalate
- Property breakdown: Article effectiveness by topic, user segment
- User paths: Documentation journey flows
- Correlation: Article engagement vs support contact

## Success Metrics
- X% self-service resolution rate
- Y% of help article searches successful
- Z% reduction in support tickets for documented issues
- Article satisfaction rating above N

## Related Questions
- Q88: Support trigger detection
- Q90: Tutorial completion funnel
- Q91: In-app guidance timing

## Owner
TBD

## Status
Template - Ready for Implementation
