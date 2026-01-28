---
description: Create a structured plan document for tracking work
---

# /plan Command

Create a new plan document for tracking work.

## Overview

Plans are structured markdown documents with YAML frontmatter that track features, initiatives, projects, and other work.

## File Location and Naming

**Location**: `nimbalyst-local/plans/[descriptive-name].md`

**Naming conventions**:
- Use kebab-case: `user-authentication-system.md`, `marketing-campaign-q4.md`
- Be descriptive: The filename should clearly indicate what the plan is about

## Required YAML Frontmatter

```yaml
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
```

## Status Values

- `draft`: Initial planning phase
- `ready-for-development`: Approved and ready to start
- `in-development`: Currently being worked on
- `in-review`: Implementation complete, pending review
- `completed`: Successfully completed
- `rejected`: Plan has been rejected or cancelled
- `blocked`: Progress blocked by dependencies

## Plan Types

Common plan types:
- `feature`: New feature development
- `bug-fix`: Bug fix or issue resolution
- `refactor`: Code refactoring/improvement
- `system-design`: Architecture/design work
- `research`: Research/investigation task
- `initiative`: Large multi-feature effort
- `improvement`: Enhancement to existing feature

## Usage

When the user types `/plan [description]`:

1. Extract key information from the description
2. Generate unique `planId` from description (kebab-case)
3. Choose appropriate `planType` based on description
4. Set `created` to today's date, `updated` to current timestamp
5. Create file in `nimbalyst-local/plans/` with proper frontmatter
6. Include relevant sections based on plan type

## Visual Mockups

When a plan involves UI components, screens, or visual design, use the `/mockup` command to create mockups.

**When to create a mockup:**
- Planning new UI components or screens
- Designing layout and structure
- Changes that need visual feedback before implementation

**When NOT to create a mockup:**
- Backend-only changes
- Refactoring that doesn't change UI
- Bug fixes with obvious solutions
- Minor UI changes with no design choices

## Best Practices

- Keep plans focused on a single objective
- Update progress regularly as work proceeds
- Use tags to categorize related plans
- Add stakeholders who need visibility
- Set realistic due dates when applicable
