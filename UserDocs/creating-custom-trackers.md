# Creating Custom Trackers

## Overview

Nimbalyst lets you track anything in your workspace using custom trackers. Want to track book characters, recipes, wine collections, or research papers? Just create a YAML file.

Built-in trackers: Plans, Decisions, Bugs, Tasks, Ideas
Custom trackers: Anything you want

## Quick Start

Create `.nimbalyst/trackers/character.yaml` in your workspace:

```yaml
type: character
displayName: Character
displayNamePlural: Characters
icon: person
color: "#8b5cf6"

modes:
  inline: true        # Allow #character[...] in any doc
  fullDocument: true  # Allow full profile documents

fields:
  - name: name
    type: string
    required: true
  - name: role
    type: select
    options:
      - { value: protagonist, label: Protagonist }
      - { value: antagonist, label: Antagonist }
  - name: series
    type: string
```

Restart Nimbalyst. Now type `#character` in any document.

## Reference

### Basic Structure

```yaml
type: character              # Unique ID (lowercase, hyphenated)
displayName: Character       # Shown in UI
displayNamePlural: Characters
icon: person                 # Material Symbols icon name
color: "#8b5cf6"            # Hex color
```

Icons: Browse [Material Symbols](https://fonts.google.com/icons) - use any icon name

### Modes

```yaml
modes:
  inline: true           # Allow #character[...] references
  fullDocument: true     # Allow full profile documents
```

Use inline-only for lightweight items (tags, quick notes)
Use fullDocument-only for detailed profiles (plans, comprehensive docs)
Use both for flexibility

### Fields

```yaml
fields:
  - name: title
    type: string | text | number | select | date | array | object
    required: true
    default: "value"
  - name: status
    type: select
    options:
      - { value: active, label: Active, icon: check_circle, color: "#22c55e" }
```

Field types: `string`, `text`, `number`, `select`, `date`, `array`, `object`

### Layouts

```yaml
# Status bar (full documents)
statusBarLayout:
  - row:
    - { field: status, width: 200 }
    - { field: priority, width: 150 }

# Inline display
inlineTemplate: "{icon} {name} ({role})"

# Table view
tableView:
  defaultColumns: [name, status, updated]
```

## Examples

### Character Tracker

See complete example with fields for name, role, status, series, allegiance, traits, relationships, etc. in `examples/character.yaml`

Usage:
- Inline: `#character````````````[name:"Aragorn" role:protagonist]`
- Full doc: Create `characters/aragorn.md` with `characterStatus:` frontmatter

### Recipe Tracker

See `examples/recipe.yaml` - tracks cuisine, difficulty, prep/cook time, servings, rating

### Research Paper Tracker

See `examples/research-paper.yaml` - tracks authors, year, venue, status, rating, topic

## Usage

**Inline**: Type `#character` in any doc, typeahead shows your tracker
**Full doc**: Create doc with `characterStatus:` frontmatter, status bar renders automatically
**Table**: Add `<!-- tracker-table type="character" -->` to show all items

## Tips

**Naming**:
- Type: `lowercase-hyphenated`
- Display: `Title Case`
- Fields: `camelCase`
- ID prefix: `3-4 chars`

**When to use**:
- Inline: Quick refs, lightweight items
- Full docs: Detailed profiles, rich content
- Both: Flexible tracking

**Auto-managed**: Fields named `created`, `updated`, and ID are auto-managed

## Troubleshooting

**Not loading**: Check `.nimbalyst/trackers/yourtype.yaml` location, verify YAML syntax, restart app
**No typeahead**: Set `modes.inline: true`
**No status bar**: Set `modes.fullDocument: true`, use `{type}Status:` frontmatter key
