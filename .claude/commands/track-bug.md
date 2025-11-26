# track-bug
Track a bug using Nimbalyst's inline tracker syntax.

## Context Awareness

You should be context-aware when tracking bugs:

1. **If working on a plan document** (file has `planStatus` frontmatter):
   - Add the bug to the current plan file
   - Add it in a relevant section (e.g., "Bugs", "Known Issues", "Problems", etc.)
   - If no such section exists, create a "## Known Issues" section

2. **If the bug is related to a specific feature/component**:
   - Check if there's a plan document for that feature in `.nimbalyst-local/plans/`
   - If found, add the bug there

3. **Otherwise** (general bug or no specific context):
   - Add the bug to `.nimbalyst-local/tracker/bugs.md`
   - If the file doesn't exist, create it with proper structure

## Bug Tracker Syntax

Use the inline tracker syntax with the `#bug` prefix:

```markdown
- [Brief bug description] #bug[id:bug_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
```

### Required Fields
- `id`: Unique identifier using format `bug_[ulid]` where ulid is a 26-character Base32 string
- `status`: Current status (to-do | in-progress | done)
- `priority`: Bug severity (low | medium | high | critical)
- `created`: Creation date in YYYY-MM-DD format

### Optional Fields
- `title`: Explicit title (if different from the line text)
- `updated`: Last update timestamp in ISO format (YYYY-MM-DDTHH:MM:SS.sssZ)

## ID Generation

Generate a unique ULID (Universally Unique Lexicographically Sortable Identifier):
- Format: 26 characters, Base32 encoded (0-9, A-Z excluding I, L, O, U)
- Structure: 10 chars timestamp + 16 chars random
- Example: `01HQXYZ7890ABCDEF12345`

Full bug ID format: `bug_01HQXYZ7890ABCDEF12345`

## Examples

### Simple bug
```markdown
- Login button doesn't work on mobile Safari #bug[id:bug_01HQXYZ7890ABCDEF12345 status:to-do priority:high created:2025-10-24]
```

### Bug with title
```markdown
- Safari mobile login issue #bug[id:bug_01HQXYZ7890ABCDEF12346 status:in-progress priority:high created:2025-10-24 title:"Mobile Safari Login Failure"]
```

### Bug with update timestamp
```markdown
- API timeout on large requests #bug[id:bug_01HQXYZ7890ABCDEF12347 status:to-do priority:critical created:2025-10-24 updated:2025-10-24T14:30:00.000Z]
```

## File Structure for bugs.md

If creating a new `.nimbalyst-local/tracker/bugs.md` file, use this structure:

```markdown
# Bugs

## Active Bugs

- [Bug descriptions go here with #bug syntax]

## Completed Bugs

- [Completed bugs with status:done]
```

## Process

1. Extract the bug description from the user's request
2. Determine the appropriate file based on context
3. Generate a unique ULID for the bug ID
4. Create the bug entry with proper syntax
5. Add it to the appropriate section in the file
6. Confirm to the user where the bug was tracked

## Important Notes

- Never hardcode IDs - always generate a new ULID for each bug
- Always include the creation date
- Default priority is "medium" unless user specifies otherwise
- Default status is "to-do" for new bugs
- Preserve existing file formatting and structure
- If adding to an existing section, maintain consistent list formatting
