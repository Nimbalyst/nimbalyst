---
packageVersion: 1.0.0
packageId: core
---

# /track Command

Create a tracking item in the appropriate tracking document.

## Tracking System Overview

Tracking items are organized by type in `nimbalyst-local/tracker/`. Common types include:
- **Bugs**: Issues and defects that need fixing
- **Tasks**: Work items and todos
- **Ideas**: Concepts and proposals to explore
- **Decisions**: Important decisions and their rationale
- **Feature Requests**: User-requested features
- **User Stories**: User-focused functionality
- **Feedback**: User feedback and insights
- **Tech Debt**: Technical debt items

## Tracking Item Structure

```markdown
- [Brief description] #[type][id:[type]_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
```

## Usage

When the user types `/track [type] [description]`:

Where `[type]` is the tracker type (e.g., bug, task, idea, feature-request, etc.)

1. Parse the type from the command
2. Generate ULID for the unique item ID
3. Determine priority based on description keywords:
   - "critical", "urgent", "blocking" → high/critical
   - "nice to have", "minor", "low" → low
   - Otherwise → medium
4. Add to appropriate tracker file (`nimbalyst-local/tracker/[type]s.md`)
5. Confirm to the user where the item was tracked

## Examples

```
/track bug Login fails on mobile Safari
/track task Update API documentation
/track idea Add dark mode support
/track feature-request Export to PDF functionality
/track decision Use PostgreSQL for database
/track feedback Users find settings page confusing
```

## Multi-Type Support

The `/track` command automatically detects which tracker schemas are installed in your workspace and routes items to the appropriate file. If a tracker type doesn't exist, it will suggest creating one or offer alternatives.

## Best Practices

- Be specific in descriptions
- Include context when helpful
- Use consistent naming for types
- Review and update tracked items regularly
- Set priorities appropriately
- Link to related plans or documents when relevant
