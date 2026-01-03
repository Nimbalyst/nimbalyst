# Q77: Enterprise Provider Consolidation

**Category:** Product Strategy
**Priority:** Medium
**Scope:** Enterprise Integration Analysis

## Question
Do enterprise teams consolidate around specific AI providers/models? What provider preferences emerge in team environments?

## Business Context
Understanding enterprise provider preferences helps prioritize integrations, negotiate partnerships, and tailor enterprise offerings.

## Required Events/Properties
- AI provider selection events
- Model selection by team
- Provider usage frequency
- Team-wide provider settings
- Provider switching events
- Team size and industry

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Enterprise tier users
- Team admins
- AI feature users
- Users by industry vertical

## Analysis Approach
1. Analyze provider distribution in team vs solo accounts
2. Track provider standardization within teams
3. Examine provider switching patterns in enterprise
4. Correlate provider choice with team size/industry
5. Identify factors driving provider consolidation

## Expected Insights
- Provider preference differences: enterprise vs individual
- Team standardization vs individual choice
- Industry-specific provider preferences
- Provider switching triggers in enterprise
- Impact of provider choice on team collaboration

## PostHog Query Strategy
- User segments: Provider usage by account type
- Property breakdown: Providers by team size, industry
- Trend analysis: Provider adoption over time in enterprise
- Correlation: Provider consolidation vs team satisfaction

## Success Metrics
- X% of enterprise teams standardize on Y providers
- Z% provider consistency within teams
- Enterprise accounts use average N providers
- Provider consolidation within A days of team setup

## Related Questions
- Q16: AI provider/model usage patterns
- Q73: Enterprise feature stacking
- Q39: Premium tier usage patterns

## Owner
TBD

## Status
Template - Ready for Implementation
