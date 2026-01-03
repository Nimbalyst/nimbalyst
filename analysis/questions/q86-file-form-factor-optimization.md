# Q86: File Form Factor Optimization

**Category:** User Experience
**Priority:** Medium
**Scope:** Cross-Device Document Analysis

## Question
Are certain document types better suited for specific form factors? How do users adapt documents for different devices?

## Business Context
Understanding document-device fit helps optimize content creation patterns and identify opportunities for form factor-specific templates or layouts.

## Required Events/Properties
- Document creation events by platform
- Document type
- Primary editing platform
- Platform switching for same document
- Document view/edit ratio by platform
- Screen size and orientation

## Cohorts
- All active users (excluding `all_filtered_cohorts`, filtering `is_dev_user != true`)
- Multi-platform users
- Users by primary device type
- Content creators by document type

## Analysis Approach
1. Analyze document type distribution by platform
2. Track primary creation vs consumption platforms
3. Examine platform switching patterns per document type
4. Identify view-only vs edit patterns by device
5. Correlate document characteristics with platform preference

## Expected Insights
- Document types created primarily on each platform
- Consumption vs creation platform preferences
- Documents requiring multi-platform access
- Form factor impact on document structure
- Optimal device recommendations by content type

## PostHog Query Strategy
- Property breakdown: Document type by creation platform
- User paths: Document lifecycle across platforms
- Correlation: Document properties vs platform usage
- Sequential analysis: Creation → Editing → Viewing by platform
- User segments: Platform preference by document type

## Success Metrics
- X% of documents optimized for primary platform
- Y% platform-appropriate document creation
- Z% successful cross-platform document access
- User satisfaction by document-device pairing

## Related Questions
- Q82: Responsive design engagement
- Q81: Platform switching workflows
- Q51: Document size performance

## Owner
TBD

## Status
Template - Ready for Implementation
