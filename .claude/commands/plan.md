# plan
Create a new plan document in the nimbalyst-local/plans/ directory following these guidelines:

## File Naming and Location
- Location: nimbalyst-local/plans/[descriptive-name].md
- Use kebab-case for filenames (e.g., user-authentication-system.md)
- Name should be descriptive of the feature or task

## Plan Document Structure

Every plan MUST include YAML frontmatter with the following fields:

```yaml
---
planStatus:
  planId: plan-[unique-identifier]  # Use kebab-case, e.g., plan-user-auth
  title: [Plan Title]                # Human-readable title
  status: [status]                   # See status values below
  planType: [type]                   # See plan types below
  priority: [priority]               # low | medium | high | critical
  owner: [username]                  # Primary owner/assignee
  stakeholders:                      # List of stakeholders
    - [stakeholder1]
    - [stakeholder2]
  tags:                              # Relevant tags for categorization
    - [tag1]
    - [tag2]
  created: "YYYY-MM-DD"             # Creation date (use today's date)
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"  # Last update timestamp (use current time via new Date().toISOString())
  progress: [0-100]                  # Completion percentage
  dueDate: "YYYY-MM-DD"              # Due date (optional)
  startDate: "YYYY-MM-DD"            # Start date (optional)
---
```

## Status Values
- draft: Initial planning phase
- ready-for-development: Approved and ready for implementation
- in-development: Currently being worked on
- in-review: Implementation complete, pending review
- completed: Successfully completed
- rejected: Plan has been rejected or cancelled
- blocked: Progress blocked by dependencies

## Plan Types
- feature: New feature development
- bug-fix: Bug fix or issue resolution
- refactor: Code refactoring/improvement
- system-design: Architecture/design work
- research: Research/investigation task

## Document Structure

After the frontmatter, include:

1. Title followed by plan status comment:
```markdown
# Plan Title

```

2. Goals section outlining objectives
3. System Overview or problem description
4. High-level approach (what, not how)
5. Key components or phases
6. Acceptance criteria when applicable

## CRITICAL: What NOT to Include

Plans are for PLANNING, not implementation. DO NOT include:

- Code blocks with implementation details
- Detailed TypeScript interfaces or function signatures
- CSS styling code
- Line-by-line implementation instructions
- Example code snippets (unless demonstrating a concept)
- Overly detailed step-by-step procedures

Plans should answer WHAT and WHY, not HOW. Keep it high-level and focused on:
- What needs to be built
- Why it's being built this way
- What the major components are
- What files will be affected (list them, don't show code)
- What the acceptance criteria are

The person implementing will figure out the details. The plan is for understanding scope and approach.

## Example

```markdown
---
planStatus:
  planId: plan-user-authentication
  title: User Authentication System
  status: draft
  planType: feature
  priority: high
  owner: developer
  stakeholders:
    - developer
    - product-team
  tags:
    - authentication
    - security
    - user-management
  created: "2025-10-16"
  updated: "2025-10-16T10:00:00.000Z"
  progress: 0
---

# User Authentication System


## Goals
- Implement secure user authentication
- Support multiple authentication providers
- Ensure session management

## Implementation Details
[Your implementation details here]
```

## CRITICAL: Timestamp Requirements

When creating a plan:
1. Set `created` to today's date in YYYY-MM-DD format
2. Set `updated` to the CURRENT timestamp using new Date().toISOString() format
3. NEVER use midnight timestamps (00:00:00.000Z) - always use the actual current time

The `updated` field is used to display "last updated" times in the tracker table. Using midnight timestamps will show incorrect "Xh ago" values.

When creating a plan, extract the key information from the user's request and populate all required frontmatter fields appropriately.
