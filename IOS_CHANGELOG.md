# iOS Changelog

All notable changes to the Nimbalyst iOS app will be documented in this file.

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

## [1.0.1] - 2026-03-01

Initial tracked release. Previous versions were not tracked in this changelog.

### Added
- Hierarchical session navigation with worktree and workstream sync
- Jump-to-prompt bottom sheet in session detail view
- Compact button sends /compact command through native bridge
- Voice playback routed through VPIO bus 0 for proper echo cancellation

### Fixed
- Transcript blank screen caused by React hooks ordering violation
