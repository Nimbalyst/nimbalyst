---
description: Track bugs, tasks, ideas, and other work items
---

# /track Command

Create a tracking item in the appropriate tracking document.

## Usage

```
/track [type] [description]
```

**Examples:**
- `/track bug Login fails on mobile Safari`
- `/track task Update API documentation`
- `/track idea Add dark mode support`
- `/track feature-request Export to PDF functionality`

## Tracking System

Items are organized by type in `nimbalyst-local/tracker/`:
- **bugs.md**: Issues and defects
- **tasks.md**: Work items and todos
- **ideas.md**: Concepts to explore
- **decisions.md**: Important decisions
- **feature-requests.md**: User requests
- **feedback.md**: User feedback
- **tech-debt.md**: Technical debt

## Item Format

```markdown
- [Brief description] #[type][id:[type]_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
```

## Execution Steps

1. Parse the type from the command
2. Generate ULID for unique item ID
3. Determine priority from description keywords:
   - "critical", "urgent", "blocking" → high/critical
   - "nice to have", "minor", "low" → low
   - Otherwise → medium
4. Add to `nimbalyst-local/tracker/[type]s.md`
5. Confirm where the item was tracked

## Best Practices

- Be specific in descriptions
- Include context when helpful
- Use consistent type names
- Set priorities appropriately
- Link to related plans when relevant
