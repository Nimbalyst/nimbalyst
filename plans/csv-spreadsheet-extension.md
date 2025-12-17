---
planStatus:
  planId: plan-csv-spreadsheet-extension
  title: CSV Spreadsheet Extension
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - extension
    - csv
    - spreadsheet
  created: "2025-12-17"
  updated: "2025-12-17T19:00:00.000Z"
  progress: 60
---
# CSV Spreadsheet Extension

## Overview

Build a Nimbalyst extension that provides a Google Sheets-like editing experience for CSV files, with support for basic formulas and AI-powered data manipulation.

## Goals

1. Display CSV files in a tabular spreadsheet interface within Nimbalyst tabs
2. Support inline cell editing with proper CSV serialization
3. Implement basic formula support (SUM, AVERAGE, COUNT, etc.)
4. Provide AI tools for data analysis and transformation
5. Use only permissive open-source licensed libraries (MIT, Apache-2.0)

## Library Selection

### Recommended: RevoGrid + Formula.js

After researching available options, the recommended stack is:

| Component | Library | License | Rationale |
| --- | --- | --- | --- |
| Grid UI | [RevoGrid](https://github.com/revolist/revogrid) | MIT | High performance (millions of cells), React support, actively maintained (v4.20.1 Dec 2025), virtual scrolling, column types, filtering/sorting built-in |
| Formula Engine | [formula.js](https://github.com/formulajs/formulajs) | MIT | Excel-compatible formulas, community maintained, 400+ functions |
| CSV Parsing | [Papa Parse](https://github.com/mholt/PapaParse) | MIT | Industry standard, handles edge cases (quoted fields, escapes), streaming support |

### Alternatives Considered

| Library | License | Verdict |
| --- | --- | --- |
| Handsontable | Non-commercial after v6 | Rejected: Not permissive |
| Luckysheet | MIT | Rejected: Archived Oct 2025, no longer maintained |
| Univer | Apache-2.0 | Considered but heavy (~1MB+); good for full Excel clone |
| react-data-grid | MIT | Good but no built-in formula support |
| react-spreadsheet | MIT | Simple but no formulas, non-virtualized |

## Architecture

### Extension Structure

```
packages/extensions/csv-spreadsheet/
  manifest.json
  package.json
  vite.config.ts
  src/
    index.tsx                    # Extension entry point
    components/
      SpreadsheetEditor.tsx      # Main custom editor component
      Toolbar.tsx                # Sort, filter, add row/column buttons
      FormulaBar.tsx             # Formula input display
      CellEditor.tsx             # Custom cell editor for formulas
    hooks/
      useSpreadsheetStore.ts     # Zustand store for spreadsheet state
      useFormulaEngine.ts        # Formula evaluation hook
    utils/
      csvParser.ts               # CSV parsing/serialization
      formulaParser.ts           # Formula cell detection and evaluation
    aiTools.ts                   # AI tool definitions
    styles.css                   # Themed styles using CSS variables
```

### Manifest Configuration

```json
{
  "id": "com.nimbalyst.csv-spreadsheet",
  "name": "CSV Spreadsheet",
  "version": "1.0.0",
  "description": "Edit CSV files with a spreadsheet interface and formula support",
  "author": "Nimbalyst",
  "main": "dist/index.js",
  "styles": "dist/index.css",
  "apiVersion": "1.0.0",
  "permissions": {
    "filesystem": true,
    "ai": true
  },
  "contributions": {
    "customEditors": [
      {
        "filePatterns": ["*.csv", "*.tsv"],
        "displayName": "Spreadsheet Editor",
        "component": "SpreadsheetEditor"
      }
    ],
    "aiTools": [
      "csv.analyze_data",
      "csv.add_column",
      "csv.filter_rows",
      "csv.sort_data",
      "csv.apply_formula"
    ],
    "fileIcons": {
      "*.csv": "table",
      "*.tsv": "table"
    },
    "newFileMenu": [
      {
        "extension": ".csv",
        "displayName": "CSV Spreadsheet",
        "icon": "table",
        "defaultContent": "Column A,Column B,Column C\n,,\n,,\n,,"
      }
    ]
  }
}
```

## Implementation Plan

### Phase 1: Core Editor (MVP)

1. **Setup extension scaffold**
  - Create directory structure
  - Configure vite.config.ts with externals (react, react-dom)
  - Add dependencies: `@aspect/revogrid`, `papaparse`

2. **Implement SpreadsheetEditor component**
  - Receive `CustomEditorComponentProps`
  - Parse CSV content on mount using Papa Parse
  - Render RevoGrid with parsed data
  - Track dirty state via `onDirtyChange`
  - Register save handler via `onGetContentReady`

3. **CSV parsing/serialization**
  - Handle quoted fields, commas in values, newlines
  - Support TSV variant (tab delimiter)
  - Preserve data types where detectable (numbers, dates)

4. **Basic editing**
  - Inline cell editing
  - Add/remove rows and columns
  - Copy/paste support (RevoGrid built-in)

5. **Toolbar**
  - Add row/column buttons
  - Delete row/column buttons
  - Sort ascending/descending

### Phase 2: Formula Support

1. **Formula detection**
  - Cells starting with `=` are formulas
  - Display formula in formula bar when cell selected
  - Show computed value in cell

2. **Formula evaluation**
  - Integrate formula.js for computation
  - Support cell references (A1, B2:D5)
  - Implement dependency tracking for recalculation

3. **Supported formulas (initial set)**
  - Math: SUM, AVERAGE, MIN, MAX, COUNT, ROUND
  - Logic: IF, AND, OR, NOT
  - Text: CONCAT, LEFT, RIGHT, LEN, UPPER, LOWER
  - Lookup: VLOOKUP (basic)

4. **Error handling**
  - Display #REF!, #VALUE!, #DIV/0! errors
  - Highlight cells with errors

### Phase 3: AI Tools

1. **csv.analyze\_data**
  - Compute summary statistics per column
  - Detect data types and distributions
  - Identify potential data quality issues

2. **csv.add\_column**
  - Add computed column based on existing data
  - Support formula generation by AI

3. **csv.filter\_rows**
  - Natural language filter queries
  - "Show only rows where revenue > 10000"

4. **csv.sort\_data**
  - Multi-column sort support
  - Natural language: "Sort by date descending, then by name"

5. **csv.apply\_formula**
  - Apply formula to column or range
  - "Calculate total = price * quantity for all rows"

### Phase 4: Polish

1. **Column resizing and reordering**
2. **Freeze rows/columns** (header row)
3. **Find and replace**
4. **Data validation** (restrict values, dropdown lists)
5. **Conditional formatting** (highlight cells based on value)
6. **Export options** (to different delimiters)

## UI Design

### Spreadsheet Editor Layout

```
+------------------------------------------------------------------+
| Formula Bar: [A1] [=SUM(B1:B10)                              ] |
+------------------------------------------------------------------+
| Toolbar: [+ Row] [+ Col] [Sort A-Z] [Sort Z-A] [Filter] [...]   |
+------------------------------------------------------------------+
|   | A        | B        | C        | D        | E        |      |
+------------------------------------------------------------------+
| 1 | Name     | Qty      | Price    | Total    | Category |      |
| 2 | Widget A | 10       | 5.99     | =B2*C2   | Widgets  |      |
| 3 | Widget B | 25       | 3.49     | =B3*C3   | Widgets  |      |
| 4 | Gadget X | 8        | 12.99    | =B4*C4   | Gadgets  |      |
| 5 |          |          |          |          |          |      |
+------------------------------------------------------------------+
```

### Theme Integration

All styling uses CSS variables from PlaygroundEditorTheme.css:

- `--surface-primary`: Main background
- `--surface-secondary`: Header row background
- `--surface-hover`: Cell hover state
- `--border-primary`: Grid lines
- `--text-primary`: Cell text
- `--text-secondary`: Row/column headers
- `--primary-color`: Selected cell highlight

## Technical Considerations

### Performance

- RevoGrid handles virtualization automatically
- Formula recalculation should be debounced
- Large files (>10k rows): consider lazy formula evaluation

### Data Integrity

- Always round-trip through Papa Parse for consistent CSV handling
- Preserve original formatting when possible
- Store formulas as text (=SUM(A1:A10)), compute on display

### Edge Cases

- Empty cells vs cells with empty string
- Numeric strings that shouldn't be converted (ZIP codes, IDs)
- Multi-line cell values (quoted in CSV)
- Unicode content
- Very wide cells (long text)

## Dependencies

```json
{
  "dependencies": {
    "@aspect/revogrid": "^4.20.0",
    "@aspect/revogrid-react": "^4.20.0",
    "papaparse": "^5.4.0",
    "@formulajs/formulajs": "^4.4.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

## Success Criteria

1. CSV files open in spreadsheet view by default
2. Edits are saved back to valid CSV format
3. Basic formulas (SUM, AVERAGE, IF) work correctly
4. AI can analyze and transform data via tools
5. Performance acceptable for files up to 10,000 rows
6. Theme integration matches Nimbalyst light/dark/crystal-dark

## Open Questions

1. Should formulas persist in CSV (as text) or be stripped on save?
  - Recommendation: Store as text for portability
2. Support for multiple sheets?
  - Recommendation: Not in v1 (CSV is single-sheet by nature)
3. Undo/redo implementation?
  - Recommendation: Leverage RevoGrid built-in or Nimbalyst file history

## References

- [RevoGrid Documentation](https://rv-grid.com/)
- [Formula.js Functions](https://formulajs.info/functions/)
- [Papa Parse Documentation](https://www.papaparse.com/docs)
- [nimbalyst-extension-system.md](./../design/Extensions/nimbalyst-extension-system.md)
