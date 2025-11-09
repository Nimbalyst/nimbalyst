/**
 * Developer Package
 *
 * Tools and tracker schemas optimized for software developers
 */

import { ToolPackage } from '../types/toolPackages';

export const DeveloperPackage: ToolPackage = {
  id: 'developer',
  name: 'Developer',
  description: 'Code analysis, testing tools, and developer-focused tracker schemas',
  icon: 'code',
  version: '1.0.0',
  author: 'Nimbalyst',
  tags: ['development', 'coding', 'engineering'],

  customCommands: [
    {
      name: 'analyze-code',
      description: 'Analyze code quality and suggest improvements',
      content: `---
packageVersion: 1.0.0
packageId: developer
---

# /analyze-code Command

Analyze code quality, identify potential issues, and suggest improvements.

## What This Command Does

1. Reviews code structure and patterns
2. Identifies potential bugs and anti-patterns
3. Suggests refactoring opportunities
4. Checks for security vulnerabilities
5. Evaluates code maintainability

## Usage

\`/analyze-code [path or current file]\`

## Output

Provides structured analysis with:
- Code quality score
- List of issues found with severity
- Specific suggestions for improvement
- References to best practices

## Best Practices

- Run before code reviews
- Use when refactoring legacy code
- Apply to critical code paths regularly
`,
    },
    {
      name: 'write-tests',
      description: 'Generate comprehensive tests for code',
      content: `---
packageVersion: 1.0.0
packageId: developer
---

# /write-tests Command

Generate comprehensive test coverage for existing code.

## What This Command Does

1. Analyzes code to test
2. Identifies test cases (happy path, edge cases, errors)
3. Generates test code in appropriate framework
4. Includes setup/teardown as needed

## Usage

\`/write-tests [file or function]\`

## Test Generation Approach

- Uses existing test framework in project
- Follows project test patterns
- Includes meaningful test names
- Covers edge cases and error conditions
- Adds necessary mocks/fixtures

## Best Practices

- Review generated tests for accuracy
- Adjust assertions as needed
- Run tests to verify they pass
- Add tests incrementally for large files
`,
    },
  ],

  trackerSchemas: [
    {
      type: 'bug',
      displayName: 'Bug',
      displayNamePlural: 'Bugs',
      icon: 'bug_report',
      color: '#dc2626',
      yamlContent: `# Package metadata
packageVersion: 1.0.0
packageId: developer

type: bug
displayName: Bug
displayNamePlural: Bugs
icon: bug_report
color: "#dc2626"

modes:
  inline: true
  fullDocument: false

idPrefix: bug
idFormat: ulid

fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    default: to-do
    options:
      - value: to-do
        label: To Do
      - value: in-progress
        label: In Progress
      - value: done
        label: Done
      - value: wont-fix
        label: Won't Fix

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
      type: 'task',
      displayName: 'Task',
      displayNamePlural: 'Tasks',
      icon: 'task_alt',
      color: '#2563eb',
      yamlContent: `# Package metadata
packageVersion: 1.0.0
packageId: developer

type: task
displayName: Task
displayNamePlural: Tasks
icon: task_alt
color: "#2563eb"

modes:
  inline: true
  fullDocument: false

idPrefix: task
idFormat: ulid

fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    default: to-do
    options:
      - value: to-do
        label: To Do
      - value: in-progress
        label: In Progress
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
      type: 'tech-debt',
      displayName: 'Technical Debt',
      displayNamePlural: 'Technical Debt',
      icon: 'construction',
      color: '#f59e0b',
      yamlContent: `# Package metadata
packageVersion: 1.0.0
packageId: developer

type: tech-debt
displayName: Technical Debt
displayNamePlural: Technical Debt
icon: construction
color: "#f59e0b"

modes:
  inline: true
  fullDocument: false

idPrefix: debt
idFormat: ulid

fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    default: identified
    options:
      - value: identified
        label: Identified
      - value: planned
        label: Planned
      - value: in-progress
        label: In Progress
      - value: resolved
        label: Resolved

  - name: severity
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
    default: code-quality
    options:
      - value: code-quality
        label: Code Quality
      - value: architecture
        label: Architecture
      - value: performance
        label: Performance
      - value: security
        label: Security
      - value: documentation
        label: Documentation

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
  ],

  settings: {
    commandsLocation: 'project',
  },

  dependencies: ['core'],
};
