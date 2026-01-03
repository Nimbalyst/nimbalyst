# Q72: Team Approval Workflow Usage

**Category:** Feature Engagement
**Priority:** Medium
**Scope:** Team Collaboration Analysis

## Question
Are teams using approval workflows for documents? What types of documents require approval most frequently?

## Business Context
Approval workflows are critical for enterprise adoption. Understanding their usage helps validate enterprise features and identify workflow optimization opportunities.

## Required Events/Properties
- Approval request created
- Approval granted/denied events
- Document approval status changes
- Approver role/permissions
- Document type requiring approval

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Team workspace users
- Enterprise tier users
- Approval workflow users

## Analysis Approach
1. Track approval request frequency and completion
2. Analyze approval turnaround time
3. Identify document types requiring approval
4. Examine approval chain complexity
5. Compare approval patterns across team sizes

## Expected Insights
- Approval workflow adoption rate among teams
- Average approval cycle time
- Common approval bottlenecks
- Document types with formal approval needs
- Multi-stage approval usage patterns

## PostHog Query Strategy
- Trend analysis: Approval requests over time
- Funnel: Request → Review → Approve/Deny → Complete
- Time to convert: Request to final approval
- Property breakdown: Approvals by document type, team size

## Success Metrics
- X% of enterprise teams use approval workflows
- Average approval time under Y hours
- Z% approval completion rate

## Related Questions
- Q71: Commenting/annotation adoption
- Q73: Enterprise feature stacking
- Q39: Premium tier usage patterns

## Owner
TBD

## Status
Template - Ready for Implementation
