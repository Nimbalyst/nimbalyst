# Release Notes - v0.42.32

## Bug Fixes

- **QuickOpen**: Fix worktrees directory being included in file search results, causing duplicate file entries for git worktrees
  - Added exclusion patterns for both `worktrees/` and `.worktrees/` directories
  - Updated all file filtering mechanisms (find, ripgrep, glob patterns)
  - Ensures git worktrees are properly excluded from search results
