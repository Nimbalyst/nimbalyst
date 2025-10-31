# Changelog

All notable changes to Nimbalyst will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
<!-- New features go here -->

### Changed
<!-- Changes to existing functionality go here -->

### Fixed
<!-- Bug fixes go here -->

### Removed
<!-- Removed features go here -->

## [0.43.0] - 2025-10-31


### Added
- Added slider control for tracker progress fields
- Added comprehensive analytics event tracking for feature usage
- Show workspace onboarding dialog if not completed yet

### Fixed
- Fixed restart button not disabling and showing restarting status
- Fixed missing onRestore callback in history dialog
- Fixed agent transcript sidebar entries not spanning full width
- Fixed code blocks without language specification being dropped on export
- Fixed path.join implementation bug
- Fixed config.json being appended to instead of overwritten when saving

### Changed
- Migrated organization to nimbalyst GitHub organization

### Removed
<!-- Removed features go here -->

## [0.42.60] - 2025-10-30

### Fixed
- Fixed file selection not clearing when tab is closed
- Fixed tracker document header not appearing on initial load
- Fixed files not marked dirty when tracker updates frontmatter
- Fixed error handling for missing directories in folder contents retrieval

### Changed
- Claude Code now updates database and notifies panel to check for updates
- MCP stream tool now operates synchronously for better reliability
- AI tools now require explicit file paths for better clarity

### Removed
- Removed deprecated getDocument tool

### Internal
- Modernized end-to-end test infrastructure

