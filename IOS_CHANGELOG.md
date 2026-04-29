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

## [1.1.0] - 2026-04-29

First public App Store release since 1.0. The 1.0.1 draft was never shipped; its changes are folded into 1.1.0.

### Added
- Real-time E2E encrypted collaboration on documents and trackers, with team membership and roles
- Bidirectional draft sync and queued prompts between desktop and iOS
- Hierarchical session navigation with worktree and workstream sync
- Cancel button for running AI sessions
- AI model picker on iOS, including Sonnet 4.6 (with effort slider) and Opus 4.6 1M context
- Slash command typeahead and image attachments in compose bar
- Multi-account user menu with org switching
- Email magic link login (Stytch B2B Discovery OAuth)
- Push notifications, with permission prompt after pairing
- QR code deep-linking opens Nimbalyst when scanned with the Camera app
- Jump-to-prompt sheet, clickable links, and tap-to-copy code blocks in transcripts

### Changed
- Voice playback routed through VPIO bus 0 for proper echo cancellation
- iPad layout polish: Files tab in sidebar, denser session list, single-tap session creation

### Fixed
- Transcript blank screen from React hooks ordering violation in WKWebView
- Voice mode crash on audio capture start
- Background SQLite crash from full index sync on every reconnect
- Sync resilience after network change, sleep, JWT refresh, and org switching
- Draft text jumbling, character loss, and bounce-back during fast typing
- Sessions failing to reorder when viewed; read state now syncs both ways
- Push notifications no longer suppressed by always-active device reporting
- QR scanner reliability in release builds
