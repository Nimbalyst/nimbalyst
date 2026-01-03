# Q94: Bug Report Quality and Completeness

**Category:** User Support
**Priority:** Medium
**Scope:** Bug Reporting Analysis

## Question
What percentage of bug reports contain sufficient detail for reproduction? How can we improve report quality?

## Business Context
High-quality bug reports accelerate debugging and fixes. Understanding quality patterns helps optimize bug reporting UX and guide users to provide actionable information.

## Required Events/Properties
- Bug report submission events
- Report completeness fields (steps, screenshots, logs)
- Report priority/severity
- Time to report completion
- Report actionability assessment
- Follow-up question frequency

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Users who submitted bug reports
- Users by technical expertise level
- Frequent reporters vs one-time reporters

## Analysis Approach
1. Assess bug report completeness and quality
2. Identify common missing information
3. Correlate report quality with user characteristics
4. Analyze effectiveness of reporting guidance
5. Measure impact of quality on resolution time

## Expected Insights
- Percentage of actionable bug reports
- Common quality gaps in reports
- User characteristics affecting report quality
- Effective vs ineffective reporting prompts
- Impact of quality on bug resolution speed

## PostHog Query Strategy
- Property breakdown: Report completeness by user segment
- Funnel: Start report → Add details → Submit
- Trend analysis: Report quality over time
- Correlation: Report quality vs resolution time
- User paths: Bug reporting journey

## Success Metrics
- X% of reports contain reproduction steps
- Y% of reports actionable without follow-up
- Z% reduction in follow-up questions needed
- Average report completion time under N minutes

## Related Questions
- Q93: Feedback after errors
- Q88: Support trigger detection
- Q95: Community engagement patterns

## Owner
TBD

## Status
Template - Ready for Implementation
