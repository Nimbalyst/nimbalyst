---
name: review-branch
description: Review all changes in current branch (read-only analysis)
---
Perform a comprehensive read-only review of the current git branch changes.

**CRITICAL: This is a READ-ONLY review. Do NOT:**
- Make any code changes
- Create or modify files
- Run git commands (commit, push, merge, etc.)
- Only exception: You may run git commands to READ information (diff, log, status, show)

**Steps:**

1. Run `git diff main...HEAD` to see all changes in the branch
2. Run `git log main..HEAD --oneline` to see commit history (for context only, not for analysis)
3. Run `git status` to see current state

**Analysis Required:**

Provide your review in the following format:

## Branch Summary
[Brief 2-3 sentence description of what this branch does]

## Quick Review Checklist

| Category | Status | Notes |
| --- | --- | --- |
| Database Changes | ✅ None / ⚠️ Schema / ⚠️ Migration | [Brief description if any] |
| Security Issues | ✅ None Found / ⚠️ See Below / ❌ Critical | [Count if any] |
| Performance Concerns | ✅ None Found / ⚠️ See Below | [Brief assessment] |
| Dependencies | ✅ No Changes / ⚠️ Added/Updated | [List if any] |
| Logging | ✅ Appropriate / ⚠️ Too Verbose / ⚠️ Insufficient | [Brief assessment] |
| Type Safety | ✅ Fully Typed / ⚠️ Some Any Types / ❌ Missing Types | [Issues if any] |
| Potential Bugs | ✅ None Found / ⚠️ See Below | [Count if any] |
| Junk/Cleanup | ✅ Clean / ⚠️ See Below | [Items if any] |

## Detailed Findings

### Database Changes
[List any schema changes, migrations, new tables/columns, or note "None"]

### Security Issues
[List potential security vulnerabilities:]
- XSS vulnerabilities
- SQL injection risks
- Exposed secrets/API keys
- Authentication/authorization gaps
- Unsafe deserialization
- Missing input validation
[Note "None found" if clean]

### Performance Concerns
[List potential performance issues:]
- N+1 queries
- Inefficient loops or algorithms
- Memory leaks
- Missing database indexes
- Large payload sizes
- Unnecessary re-renders
[Note "None found" if clean]

### Dependencies
[Check package.json, package-lock.json for changes:]
- New packages added: [name@version - purpose]
- Version updates: [name: old → new]
- Removed packages: [name]
[Note "No changes" if none]

### Logging Assessment
[Evaluate if logging is appropriate, too verbose, or missing. Note any console.log that should be removed]

### Type Safety Issues
[List any `any` types, missing type definitions, or type assertions that should be reviewed]

### Potential Bugs
[List specific scenarios that should be tested, edge cases not handled, null checks missing, etc.]
- Bug 1: [description]
- Bug 2: [description]

### Cleanup Needed
[List commented code, debug statements, unused imports, TODOs, etc.]
- Item 1: [description + file:line]
- Item 2: [description + file:line]

### Other Concerns
[Any additional issues not covered above:]
- Breaking changes to APIs or interfaces
- Missing error handling
- Accessibility issues
- Missing documentation
- Test coverage gaps

## Suggested Commit Message
[Provide a well-formatted commit message for the entire branch following the project's commit style, but DO NOT create the commit]

## File-by-File Analysis

| File | Changes Summary |
| --- | --- |
| path/to/file1.ts | [Explain what changed and why - focus on WHAT and WHY, not line-by-line details] |
| path/to/file2.ts | [Explain what changed and why - focus on WHAT and WHY, not line-by-line details] |
| path/to/file3.tsx | [Explain what changed and why - focus on WHAT and WHY, not line-by-line details] |

---

**Remember:** This is a review only. Do not make any changes or take any git actions unless explicitly asked by the user.