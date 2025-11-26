# track-idea
Track a feature idea using Nimbalyst's inline tracker syntax.

## Context Awareness

You should be context-aware when tracking ideas:

1. **If working on a plan document** (file has `planStatus` frontmatter):
  - Add the idea to the current plan file
  - Add it in a relevant section (e.g., "Ideas", "Future Enhancements", "Improvements", etc.)
  - If no such section exists, create a "## Future Ideas" section

2. **If the idea is related to a specific feature/component**:
  - Check if there's a plan document for that feature in `nimbalyst-local/plans/`
  - If found, add the idea there

3. **Otherwise** (general idea or no specific context):
  - Add the idea to `nimbalyst-local/tracker/ideas.md`
  - If the file doesn't exist, create it with proper structure

## Idea Tracker Syntax

Use the inline tracker syntax with the `#idea` prefix:

```markdown
- [Brief idea description] #idea[id:ida_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
```

### Required Fields
- `id`: Unique identifier using format `ida_[ulid]` where ulid is a 26-character Base32 string
- `status`: Current status (to-do | in-progress | done)
- `priority`: Idea importance (low | medium | high | critical)
- `created`: Creation date in YYYY-MM-DD format

### Optional Fields
- `title`: Explicit title (if different from the line text)
- `updated`: Last update timestamp in ISO format (YYYY-MM-DDTHH:MM:SS.sssZ)

## ID Generation

Generate a unique ULID (Universally Unique Lexicographically Sortable Identifier):
- Format: 26 characters, Base32 encoded (0-9, A-Z excluding I, L, O, U)
- Structure: 10 chars timestamp + 16 chars random
- Example: `01HQXYZ7890ABCDEF12345`

Full idea ID format: `ida_01HQXYZ7890ABCDEF12345`

## Examples

### Simple idea
```markdown
- Add dark mode to settings panel #idea[id:ida_01HQXYZ7890ABCDEF12345 status:to-do priority:medium created:2025-10-24]
```

### Idea with title
```markdown
- Dark mode settings #idea[id:ida_01HQXYZ7890ABCDEF12346 status:in-progress priority:high created:2025-10-24 title:"Dark Mode Theme Switcher"]
```

### Idea with update timestamp
```markdown
- Add keyboard shortcuts for common actions #idea[id:ida_01HQXYZ7890ABCDEF12347 status:to-do priority:low created:2025-10-24 updated:2025-10-24T14:30:00.000Z]
```

## File Structure for ideas.md

If creating a new `nimbalyst-local/tracker/ideas.md` file, use this structure:

```markdown
# Ideas

## Active Ideas

- [Idea descriptions go here with #idea syntax]

## Implemented Ideas

- [Implemented ideas with status:done]
```

## Process

1. Extract the idea description from the user's request
2. Determine the appropriate file based on context
3. Generate a unique ULID for the idea ID
4. Create the idea entry with proper syntax
5. Add it to the appropriate section in the file
6. Confirm to the user where the idea was tracked

## Important Notes

- Never hardcode IDs - always generate a new ULID for each idea
- Always include the creation date
- Default priority is "medium" unless user specifies otherwise
- Default status is "to-do" for new ideas
- Preserve existing file formatting and structure
- If adding to an existing section, maintain consistent list formatting
