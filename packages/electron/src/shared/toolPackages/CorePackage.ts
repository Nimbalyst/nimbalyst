/**
 * Core Package
 *
 * Essential commands and tracker schemas that are useful for all users
 */

import { ToolPackage } from '../types/toolPackages';

export const CorePackage: ToolPackage = {
  id: 'core',
  name: 'Core',
  description: 'Essential planning and tracking commands for all workflows',
  icon: 'verified',
  version: '1.0.0',
  author: 'Nimbalyst',
  tags: ['core', 'planning', 'tracking'],

  customCommands: [
    {
      name: 'plan',
      description: 'Create and track plans for any type of work',
      content: `---
packageVersion: 1.0.0
packageId: core
---

# /plan Command

Create a new plan document for tracking work.

## Overview

Plans are structured markdown documents with YAML frontmatter that track features, initiatives, projects, and other work.

## File Location and Naming

**Location**: \`nimbalyst-local/plans/[descriptive-name].md\`

**Naming conventions**:
- Use kebab-case: \`user-authentication-system.md\`, \`marketing-campaign-q4.md\`
- Be descriptive: The filename should clearly indicate what the plan is about

## Required YAML Frontmatter

\`\`\`yaml
---
planStatus:
  planId: plan-[unique-identifier]
  title: [Plan Title]
  status: draft
  planType: feature
  priority: medium
  owner: [your-name]
  stakeholders: []
  tags: []
  created: "YYYY-MM-DD"
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"
  progress: 0
---
\`\`\`

## Status Values

- \`draft\`: Initial planning phase
- \`ready-for-development\`: Approved and ready to start
- \`in-development\`: Currently being worked on
- \`in-review\`: Implementation complete, pending review
- \`completed\`: Successfully completed
- \`rejected\`: Plan has been rejected or cancelled
- \`blocked\`: Progress blocked by dependencies

## Plan Types

Common plan types:
- \`feature\`: New feature development
- \`bug-fix\`: Bug fix or issue resolution
- \`refactor\`: Code refactoring/improvement
- \`system-design\`: Architecture/design work
- \`research\`: Research/investigation task
- \`initiative\`: Large multi-feature effort
- \`improvement\`: Enhancement to existing feature

## Usage

When the user types \`/plan [description]\`:

1. Extract key information from the description
2. Generate unique \`planId\` from description (kebab-case)
3. Choose appropriate \`planType\` based on description
4. Set \`created\` to today's date, \`updated\` to current timestamp
5. Create file in \`nimbalyst-local/plans/\` with proper frontmatter
6. Include relevant sections based on plan type

## Best Practices

- Keep plans focused on a single objective
- Update progress regularly as work proceeds
- Use tags to categorize related plans
- Add stakeholders who need visibility
- Set realistic due dates when applicable
`,
    },
    {
      name: 'track',
      description: 'Create tracking items for work across all categories',
      content: `---
packageVersion: 1.0.0
packageId: core
---

# /track Command

Create a tracking item in the appropriate tracking document.

## Tracking System Overview

Tracking items are organized by type in \`nimbalyst-local/tracker/\`. Common types include:
- **Bugs**: Issues and defects that need fixing
- **Tasks**: Work items and todos
- **Ideas**: Concepts and proposals to explore
- **Decisions**: Important decisions and their rationale
- **Feature Requests**: User-requested features
- **User Stories**: User-focused functionality
- **Feedback**: User feedback and insights
- **Tech Debt**: Technical debt items

## Tracking Item Structure

\`\`\`markdown
- [Brief description] #[type][id:[type]_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
\`\`\`

## Usage

When the user types \`/track [type] [description]\`:

Where \`[type]\` is the tracker type (e.g., bug, task, idea, feature-request, etc.)

1. Parse the type from the command
2. Generate ULID for the unique item ID
3. Determine priority based on description keywords:
   - "critical", "urgent", "blocking" → high/critical
   - "nice to have", "minor", "low" → low
   - Otherwise → medium
4. Add to appropriate tracker file (\`nimbalyst-local/tracker/[type]s.md\`)
5. Confirm to the user where the item was tracked

## Examples

\`\`\`
/track bug Login fails on mobile Safari
/track task Update API documentation
/track idea Add dark mode support
/track feature-request Export to PDF functionality
/track decision Use PostgreSQL for database
/track feedback Users find settings page confusing
\`\`\`

## Multi-Type Support

The \`/track\` command automatically detects which tracker schemas are installed in your workspace and routes items to the appropriate file. If a tracker type doesn't exist, it will suggest creating one or offer alternatives.

## Best Practices

- Be specific in descriptions
- Include context when helpful
- Use consistent naming for types
- Review and update tracked items regularly
- Set priorities appropriately
- Link to related plans or documents when relevant
`,
    },
  ],

  trackerSchemas: [],

  settings: {
    commandsLocation: 'project',
  },
};
