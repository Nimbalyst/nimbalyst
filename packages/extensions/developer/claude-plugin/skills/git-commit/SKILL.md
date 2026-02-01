---
name: git-commit
description: Create git commits using Nimbalyst's interactive commit proposal widget. Use when the user asks to commit changes, create a commit, or save their work to git.
---

# Git Commit Workflow in Nimbalyst

When committing changes in Nimbalyst, use the interactive commit proposal widget instead of running git commands directly. This provides a better user experience where users can review and adjust the proposed commit before confirming.

## Required Steps

1. **Get session-edited files**
   Call `mcp__nimbalyst-mcp__get_session_edited_files` to get ALL files you edited during this AI session.

2. **Propose the commit**
   Call `mcp__nimbalyst-mcp__developer_git_commit_proposal` with:
   - `filesToStage`: ALL session-edited files that have changes (do not cherry-pick a subset)
   - `commitMessage`: A well-crafted commit message following the guidelines below
   - `reasoning`: Explanation of why these files were selected

## Commit Message Guidelines

- Start with type prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- **Focus on IMPACT and WHY, not implementation details**
- Title describes user-visible outcome or bug fixed
- Use bullet points (dash prefix) only for multiple distinct changes
- Keep lines under 72 characters
- No emojis
- Lead with problem solved or capability added, not technique used

### Good vs Bad Examples

**BAD**: "feat: add pre-edit tagging for non-agentic AI providers"
**GOOD**: "fix: OpenAI/LMStudio diffs now persist across app restarts"

**BAD**: "refactor: extract helper function for validation"
**GOOD**: "fix: prevent crash when user input is empty"

## Important

- Do NOT run `git add` or `git commit` commands directly
- Do NOT add "Co-Authored-By" or attribution lines
- Do NOT add marketing taglines or links
- Include ALL session-edited files that have changes - the user can deselect files in the widget if needed
- The widget allows users to review, edit the message, and select/deselect files before confirming
