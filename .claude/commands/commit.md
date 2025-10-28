---
name: commit
description: Create a git commit with concise, bullet-point commit message
---
Create a git commit following these steps:

1. Run `git status` and `git diff` to see changes
2. Review recent commits (`git log --oneline -5`) to match the style
3. Draft a concise commit message:
  - Start with type prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
  - Use bullet points (dash prefix) only if there are multiple distinct changes
  - Focus on WHAT changed and WHY (not HOW unless critical)
  - Keep each line under 72 characters
  - Be concise - only mention what was added/changed, not what was kept
  - No emojis
4. Stage relevant files with `git add`
5. Create the commit with your message
6. Run `git status` to confirm

**Important:**
- Do NOT add "Co-Authored-By" or any attribution lines
- Do NOT add marketing taglines or links
- Be direct and factual
- Keep it brief - avoid unnecessary details about what wasn't changed
- Only explain implementation details if they're non-obvious and important
