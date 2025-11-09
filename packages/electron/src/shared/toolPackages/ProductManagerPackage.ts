/**
 * Product Manager Package
 *
 * Tools and tracker schemas optimized for product managers
 */

import { ToolPackage } from '../types/toolPackages';

export const ProductManagerPackage: ToolPackage = {
  id: 'product-manager',
  name: 'Product Manager',
  description: 'Roadmap generation, user research tools, and product-focused tracker schemas',
  icon: 'dashboard',
  version: '1.0.0',
  author: 'Nimbalyst',
  tags: ['product', 'planning', 'management'],

  customCommands: [
    {
      name: 'roadmap',
      description: 'Generate product roadmap from plans and features',
      content: `---
packageVersion: 1.0.0
packageId: product-manager
---

# /roadmap Command

Generate a product roadmap view from existing plans and feature requests.

## What This Command Does

1. Scans all plan documents
2. Groups by quarter or timeframe
3. Organizes by priority and dependencies
4. Creates visual roadmap document

## Usage

\`/roadmap [timeframe]\`

**Timeframes:**
- \`quarter\`: Group by quarter (Q1, Q2, Q3, Q4)
- \`month\`: Group by month
- \`year\`: Annual view

## Output

Creates a roadmap document with:
- Timeline visualization
- Features grouped by timeframe
- Priority indicators
- Status of each initiative
- Dependencies highlighted

## Best Practices

- Update plan statuses before generating roadmap
- Review with stakeholders regularly
- Keep roadmap in sync with actual progress
`,
    },
    {
      name: 'user-research',
      description: 'Document user research findings',
      content: `---
packageVersion: 1.0.0
packageId: product-manager
---

# /user-research Command

Create a structured document for user research findings.

## What This Command Does

Creates a research document template with sections for:
- Research objectives
- Methodology
- Participant demographics
- Key findings
- Insights and recommendations
- Next steps

## Usage

\`/user-research [research topic]\`

## Document Structure

Includes sections for:
- **Executive Summary**: High-level takeaways
- **Objectives**: What we wanted to learn
- **Methodology**: How research was conducted
- **Participants**: Who was involved
- **Findings**: Detailed observations
- **Insights**: What findings mean
- **Recommendations**: Suggested actions
- **Appendix**: Supporting materials

## Best Practices

- Document research as soon as possible
- Include direct quotes from participants
- Link findings to specific features or plans
- Share with team for visibility
`,
    },
  ],

  trackerSchemas: [
    {
      type: 'feature-request',
      displayName: 'Feature Request',
      displayNamePlural: 'Feature Requests',
      icon: 'featured_play_list',
      color: '#3b82f6',
      yamlContent: `# Package metadata
packageVersion: 1.0.0
packageId: product-manager

type: feature-request
displayName: Feature Request
displayNamePlural: Feature Requests
icon: featured_play_list
color: "#3b82f6"

modes:
  inline: true
  fullDocument: false

idPrefix: feat
idFormat: ulid

fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    default: new
    options:
      - value: new
        label: New
      - value: considering
        label: Considering
      - value: planned
        label: Planned
      - value: in-development
        label: In Development
      - value: shipped
        label: Shipped
      - value: declined
        label: Declined

  - name: priority
    type: select
    default: medium
    options:
      - value: low
        label: Low
      - value: medium
        label: Medium
      - value: high
        label: High
      - value: critical
        label: Critical

  - name: category
    type: select
    default: enhancement
    options:
      - value: enhancement
        label: Enhancement
      - value: new-feature
        label: New Feature
      - value: improvement
        label: Improvement

  - name: source
    type: select
    default: internal
    options:
      - value: customer
        label: Customer Request
      - value: internal
        label: Internal
      - value: user-research
        label: User Research
      - value: analytics
        label: Analytics

  - name: owner
    type: string
    displayInline: true

  - name: description
    type: text
    displayInline: false

  - name: created
    type: string
    displayInline: false

  - name: updated
    type: string
    displayInline: false
`,
    },
    {
      type: 'user-story',
      displayName: 'User Story',
      displayNamePlural: 'User Stories',
      icon: 'person',
      color: '#8b5cf6',
      yamlContent: `# Package metadata
packageVersion: 1.0.0
packageId: product-manager

type: user-story
displayName: User Story
displayNamePlural: User Stories
icon: person
color: "#8b5cf6"

modes:
  inline: true
  fullDocument: false

idPrefix: story
idFormat: ulid

fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    default: backlog
    options:
      - value: backlog
        label: Backlog
      - value: ready
        label: Ready
      - value: in-progress
        label: In Progress
      - value: review
        label: In Review
      - value: done
        label: Done

  - name: priority
    type: select
    default: medium
    options:
      - value: low
        label: Low
      - value: medium
        label: Medium
      - value: high
        label: High
      - value: critical
        label: Critical

  - name: storyPoints
    type: number
    min: 0
    max: 13
    displayInline: true

  - name: owner
    type: string
    displayInline: true

  - name: acceptanceCriteria
    type: text
    displayInline: false

  - name: created
    type: string
    displayInline: false

  - name: updated
    type: string
    displayInline: false
`,
    },
    {
      type: 'feedback',
      displayName: 'User Feedback',
      displayNamePlural: 'User Feedback',
      icon: 'feedback',
      color: '#ec4899',
      yamlContent: `# Package metadata
packageVersion: 1.0.0
packageId: product-manager

type: feedback
displayName: User Feedback
displayNamePlural: User Feedback
icon: feedback
color: "#ec4899"

modes:
  inline: true
  fullDocument: false

idPrefix: fb
idFormat: ulid

fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    default: new
    options:
      - value: new
        label: New
      - value: reviewing
        label: Reviewing
      - value: addressed
        label: Addressed
      - value: wont-address
        label: Won't Address

  - name: sentiment
    type: select
    default: neutral
    options:
      - value: positive
        label: Positive
      - value: neutral
        label: Neutral
      - value: negative
        label: Negative

  - name: source
    type: select
    default: direct
    options:
      - value: direct
        label: Direct Feedback
      - value: support
        label: Support Ticket
      - value: survey
        label: Survey
      - value: review
        label: App Review
      - value: social
        label: Social Media

  - name: userSegment
    type: string
    displayInline: true

  - name: description
    type: text
    displayInline: false

  - name: created
    type: string
    displayInline: false

  - name: updated
    type: string
    displayInline: false
`,
    },
  ],

  settings: {
    commandsLocation: 'project',
  },

  dependencies: ['core'],
};
