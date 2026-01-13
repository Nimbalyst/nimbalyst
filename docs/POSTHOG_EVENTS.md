# PostHog Events Reference

This document catalogs all PostHog analytics events tracked in Nimbalyst. **This document MUST be updated whenever PostHog events are added, modified, or removed.**

## Version Tracking

Each event table includes columns tracking when events were first added and when significant changes were made. This helps understand the data available in PostHog at different points in time.

### Column Definitions

| Column | Description |
| --- | --- |
| **First Added (Public)** | The first public release version where this event was included. Events added before v0.45.25 (the first public alpha) show v0.45.25. |
| **Significant Changes** | Notable modifications to how the event is tracked (new properties, behavior changes, bug fixes). Each entry should include the version and a brief description. |

### How to Fill In These Columns

When adding or modifying events:

1. **For new events being added:**
   - If the change is not yet released publicly, use: `(pending release as of <short-commit-hash>)`
   - Example: `(pending release as of abc1234)`
   - Once released, update to the actual public version: `v0.49.14`

2. **For modifications to existing events:**
   - Add an entry to the "Significant Changes" column
   - Format: `v0.X.Y: <brief description>`
   - Multiple changes should be separated by `<br/>`
   - Example: `v0.48.13: Added slashCommandName property<br/>v0.47.2: Added hasAttachments property`

3. **Determining the public release version:**
   - Check which public release contains your commit: `git tag --contains <commit-hash> --sort=version:refname | head -1`
   - Then verify if that version is a public release (check https://github.com/Nimbalyst/nimbalyst/releases)
   - If the internal version isn't publicly released yet, find the next public release that contains it

4. **Public release versions** (as of this writing):
   - v0.45.25 (2025-11-14) - First public alpha
   - v0.45.26 (2025-11-14)
   - v0.45.34 (2025-11-19)
   - v0.46.0 (2025-11-24)
   - v0.46.1 (2025-11-25)
   - v0.47.2 (2025-12-10)
   - v0.48.13 (2025-12-17)
   - v0.49.14 (2025-12-27)
   - Check https://github.com/Nimbalyst/nimbalyst/releases for the latest list

## Overview

Nimbalyst uses PostHog for anonymous usage analytics with two tracking contexts:
- **Main Process**: Server-side events via `AnalyticsService.getInstance().sendEvent()`
- **Renderer Process**: Client-side events via `usePostHog()` hook from posthog-js/react

All events include `$session_id` property automatically. Dev users are marked with `is_dev_user: true` via `$set_once`.

## Events Catalog

### File Operations

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `file_opened` | `FileHandlers.ts:85`<br/>`WorkspaceHandlers.ts:804` | User opens file via dialog or workspace tree | `source` (dialog/workspace)<br/>`fileType`<br/>`hasWorkspace` | v0.45.25 (2025-11-14) | |
| `file_saved` | `FileHandlers.ts:199` | User manually saves file (Cmd+S) | `saveType` (manual)<br/>`fileType`<br/>`hasFrontmatter`<br/>`wordCount` | v0.45.25 (2025-11-14) | |
| `file_save_failed` | `FileHandlers.ts:212, 277` | File save operation fails | `errorType`<br/>`fileType`<br/>`isAutoSave` | v0.45.25 (2025-11-14) | |
| `file_conflict_detected` | `FileHandlers.ts:138` | File changed on disk since last load | `fileType`<br/>`conflictResolution` (pending) | v0.45.25 (2025-11-14) | |
| `file_created` | `FileHandlers.ts:399`<br/>`WorkspaceHandlers.ts:154` | User creates new file | `creationType` (new_file_menu/ai_tool)<br/>`fileType` (markdown/mockup/text/other) | v0.45.25 (2025-11-14) | v0.47.2 (2025-12-10): Added mockup fileType |
| `file_renamed` | `WorkspaceHandlers.ts:592` | User renames file in workspace | None | v0.45.25 (2025-11-14) | |
| `file_deleted` | `WorkspaceHandlers.ts:618` | User deletes file from workspace | None | v0.45.25 (2025-11-14) | |

### Workspace Operations

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `workspace_opened` | `SessionState.ts:122`<br/>`index.ts:406`<br/>`WorkspaceManagerWindow.ts:292` | Workspace opened from startup, CLI, or dialog | `fileCount` (1-10, 11-50, 51-100, 100+)<br/>`hasSubfolders`<br/>`source` (startup_restore/cli) | v0.45.25 (2025-11-14) | |
| `workspace_opened_with_filter` | `index.ts:433` | Workspace opened with git-worktree filter | `filter` (git-worktree)<br/>`$set_once: ever_opened_direct_to_worktree` | v0.45.25 (2025-11-14) | |
| `workspace_file_tree_expanded` | `WorkspaceWatcher.ts:53` | File tree expands with new files detected | `depth`<br/>`fileCount` (0-10, 11-50, 51-100, 100+) | v0.45.25 (2025-11-14) | |
| `workspace_search_used` | `QuickOpen.tsx:130, 230` | User searches workspace (files or content) | `resultCount` (0-4, 5-9, 10-49, 50-99, 100+)<br/>`queryLength` (1, 2-3, 4-9, 10+)<br/>`searchType` (file_name/content) | v0.45.25 (2025-11-14) | |

### Theme Management

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `theme_changed` | `ApplicationMenu.ts:848, 877, 906, 937` | User selects theme from Window > Theme menu | `theme` (light/dark/crystal-dark/system) | v0.45.25 (2025-11-14) | |

### Navigation & Editor Mode

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `content_mode_switched` | `NavigationGutter.tsx:111` | User switches between Files and Agent modes via navigation gutter | `fromMode` (files/agent/settings)<br/>`toMode` (files/agent/settings) | v0.48.13 (2025-12-17) | |
| `editor_type_opened` | `TabEditor.tsx:242` | User opens a file in an editor tab | `editorCategory` (markdown/monaco/image or extension name like "Spreadsheet Editor", "PDF Viewer", "Excalidraw Editor", "Data Model Editor")<br/>`fileExtension` (e.g., .md, .csv, .prisma, .mockup.html)<br/>`hasMermaid` (boolean, for markdown)<br/>`hasDataModel` (boolean, for markdown) | v0.48.13 (2025-12-17) | (pending release): Renamed editorType to editorCategory; editorCategory now uses extension displayName for custom editors; fileExtension contains actual extension |
| `markdown_view_mode_switched` | `TabEditor.tsx:1556, 1606` | User switches between rich text (lexical) and raw markdown (monaco) view modes | `fromMode` (lexical/monaco)<br/>`toMode` (lexical/monaco) | v0.48.13 (2025-12-17) | |

### File History

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `file_history_opened` | `HistoryDialog.tsx:103` | User opens the file history dialog (Cmd+Y) | `fileType` (markdown/code/image) | v0.48.13 (2025-12-17) | |
| `file_history_restored` | `HistoryDialog.tsx:260` | User restores a previous version from history | `fileType` (markdown/code/image) | v0.48.13 (2025-12-17) | |

### AI Chat & Sessions

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `create_ai_session` | `AIService.ts:455` | User creates new AI chat session | `provider` | v0.45.25 (2025-11-14) | |
| `ai_message_sent` | `AIService.ts:1286` | User sends message in AI chat | `provider`<br/>`hasDocumentContext`<br/>`hasAttachments`<br/>`contentMode` (files/agent/unknown)<br/>`usedSlashCommand` (optional)<br/>`slashCommandName` (optional)<br/>`slashCommandPackageId` (optional) | v0.45.25 (2025-11-14) | v0.47.2 (2025-12-10): Added usedSlashCommand, slashCommandName, slashCommandPackageId properties |
| `ai_response_received` | `AIService.ts:1092, 1326` | AI provider returns response | `provider`<br/>`responseType` (text/tool_use/error)<br/>`toolsUsed`<br/>`usedChartTool` | v0.45.25 (2025-11-14) | (pending release as of f74f38fb): Added usedChartTool property |
| `ai_response_streamed` | `AIService.ts:1100` | AI response finishes streaming | `provider`<br/>`chunkCount` (0-9, 10-49, 50-99, 100+)<br/>`totalLength` (0-99, 100-499, 500-999, 1000+) | v0.45.25 (2025-11-14) | |
| `ai_stream_interrupted` | `AIService.ts:1024, 1483` | AI streaming stops prematurely | `provider`<br/>`chunksReceived`<br/>`reason` (error/user_cancel) | v0.45.25 (2025-11-14) | |
| `ai_request_failed` | `AIService.ts:1319` | AI API request fails | `provider`<br/>`errorType` (network/auth/timeout/rate_limit/overloaded/unknown)<br/>`retryAttempt` | v0.45.25 (2025-11-14) | |
| `ai_session_resumed` | `AIService.ts:2016` | User intentionally opens session from history (not app startup, tab switching, or session reload) | `provider`<br/>`messageCount` (0, 1, 2-4, 5-9, 10+)<br/>`ageInDays` (today/1-day/2-6-days/1-4-weeks/1-3-months/3-months-plus) | v0.45.25 (2025-11-14) | v0.48.13 (2025-12-17): Fixed to no longer fire on app startup, tab switching, or session reload |
| `cancel_ai_request` | `AIService.ts:1491` | User cancels active AI request | `provider` | v0.45.25 (2025-11-14) | |
| `ai_diff_accepted` | `DiffApprovalBar.tsx:315, 436`<br/>`TabEditor.tsx:1382` | User accepts diff or all diffs (markdown/code/mockup) | `acceptType` (partial/all)<br/>`replacementCount`<br/>`fileType` (mockup, optional) | v0.45.25 (2025-11-14) | |
| `ai_diff_rejected` | `DiffApprovalBar.tsx:380, 450`<br/>`TabEditor.tsx:1442` | User rejects diff or all diffs (markdown/code/mockup) | `rejectType` (partial/all)<br/>`replacementCount`<br/>`fileType` (mockup, optional) | v0.45.25 (2025-11-14) | |

### Claude Code (MCP)

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `claude_code_session_started` | `AIService.ts:1178` | Claude Code provider initializes session | `mcpServerCount`<br/>`slashCommandCount`<br/>`agentCount` | v0.45.25 (2025-11-14) | |
| `slash_command_suggestion_clicked` | `SlashCommandSuggestions.tsx:117` | User clicks a slash command suggestion pill in empty session | `commandName`<br/>`packageId` | v0.47.2 (2025-12-10) | |

### MCP Server Configuration

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `mcp_server_configured` | `MCPServersPanel.tsx:967` | User successfully saves an MCP server configuration | `templateId` (null if custom)<br/>`scope` (user/workspace)<br/>`isCustom`<br/>`authType` (oauth/api-key/none)<br/>`transportType` (stdio/sse) | (pending release as of 4734f601) | |
| `mcp_server_test_result` | `MCPServersPanel.tsx:1134` | User tests MCP server connection | `templateId` (null if custom)<br/>`success`<br/>`errorType` (command_not_found/timeout/auth_failure/network/other/exception, only on failure)<br/>`durationMs` | (pending release as of 4734f601) | |
| `mcp_oauth_result` | `MCPServersPanel.tsx:852` | OAuth authorization flow completes | `templateId` (null if custom)<br/>`success`<br/>`errorType` (auth_rejected/exception, only on failure) | (pending release as of 4734f601) | |

### Terminal

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `terminal_session_created` | `TerminalHandlers.ts:75` | User creates a new terminal session | `shell` (zsh/bash/fish/unknown) | (pending release as of 9830e6b0) | |

### AI Tool Execution

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `apply_diff_tool` | `ToolExecutor.ts:55` | AI applies diff/code replacement via tool | None | v0.45.25 (2025-11-14) | |
| `ai_stream_content_used` | `ToolExecutor.ts:115` | AI streams content to document via tool | None | v0.45.25 (2025-11-14) | |
| `create_document_tool` | `ToolExecutor.ts:245` | AI creates new document via tool | None | v0.45.25 (2025-11-14) | |
| `execute_custom_tool` | `ToolExecutor.ts:358` | AI executes custom MCP tool | None | v0.45.25 (2025-11-14) | |

### AI Configuration

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `ai_provider_configured` | `GlobalSettingsScreen.tsx:276` | User enables/disables AI provider in settings | `provider`<br/>`modelCount`<br/>`action` (enabled/disabled) | v0.45.25 (2025-11-14) | |
| `ai_model_selected` | `GlobalSettingsScreen.tsx:377` | User selects specific AI model | `provider`<br/>`modelName` | v0.45.25 (2025-11-14) | |

### Attachments

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `add_attachment` | `AttachmentService.ts:112` | User attaches file to AI chat message | None | v0.45.25 (2025-11-14) | |
| `delete_attachment` | `AttachmentService.ts:148` | User removes attachment from message | None | v0.45.25 (2025-11-14) | |

### Project Settings & Packages

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `project_settings_opened` | `ProjectSettingsScreen.tsx:55` | User opens project settings screen | `isFirstTime`<br/>`totalPackages`<br/>`installedPackages` | v0.45.25 (2025-11-14) | |
| `package_installed` | `ProjectSettingsScreen.tsx:79` | User successfully installs package | `packageId`<br/>`packageName` | v0.45.25 (2025-11-14) | |
| `package_install_failed` | `ProjectSettingsScreen.tsx:91` | Package installation fails | `packageId`<br/>`error` | v0.45.25 (2025-11-14) | |
| `package_uninstalled` | `ProjectSettingsScreen.tsx:116` | User successfully uninstalls package | `packageId`<br/>`packageName` | v0.45.25 (2025-11-14) | |
| `package_uninstall_failed` | `ProjectSettingsScreen.tsx:128` | Package uninstallation fails | `packageId`<br/>`error` | v0.45.25 (2025-11-14) | |

### Extensions

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `extension_toggled` | `InstalledExtensionsPanel.tsx:81` | User enables or disables an extension | `action` (enabled/disabled) | v0.45.25 (2025-11-14) | |

### Menu & Application

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `menu_action_used` | `ApplicationMenu.ts:476, 968` | User clicks certain menu items | Varies by menu item | v0.45.25 (2025-11-14) | |
| `global_settings_opened` | `ApplicationMenu.ts:517, 1282`<br/>`AIModelsWindow.ts:50` | User opens global settings or AI models window | None | v0.45.25 (2025-11-14) | |
| `help_accessed` | `ApplicationMenu.ts:1336, 1348, 1363, 1381, 1396, 1408, 1423` | User clicks help menu items | Varies by help item | v0.45.25 (2025-11-14) | |
| `keyboard_shortcut_used` | `AnalyticsHandlers.ts:29` | User triggers keyboard shortcut (reported from renderer) | `shortcut`<br/>`context` | v0.45.25 (2025-11-14) | |
| `toolbar_button_clicked` | `AnalyticsHandlers.ts:37` | User clicks toolbar button (reported from renderer) | `button`<br/>`isFirstUse` | v0.45.25 (2025-11-14) | |

### System & Database

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `uncaught_error` | `ErrorNotificationService.ts:210, 242` | Uncaught exception or unhandled promise rejection in renderer | `errorType` (exception/unhandled_rejection)<br/>`errorCategory` (TypeError/ReferenceError/Error/etc) | v0.47.2 (2025-12-10) | |
| `database_error` | `PGLiteDatabaseWorker.ts:255, 275` | Database operation fails | `operation` (read/write)<br/>`errorType`<br/>`tableName` | v0.45.25 (2025-11-14) | |
| `database_corruption_detected` | `PGLiteDatabaseWorker.ts:131` | Database corruption detected during initialization | `hasBackups` | v0.45.25 (2025-11-14) | |
| `database_corruption_recovery_choice` | `PGLiteDatabaseWorker.ts:153, 215, 222, 272` | User makes a choice in database corruption recovery dialog | `choice` (restore_from_backup/start_fresh/auto_fresh)<br/>`confirmed` (for start_fresh)<br/>`reason` (for auto_fresh) | v0.45.25 (2025-11-14) | |
| `database_corruption_restore_result` | `PGLiteDatabaseWorker.ts:165, 185, 232, 253` | Result of attempting to restore from backup | `success`<br/>`source` (current/previous)<br/>`errorType` (verification_failed/restore_failed)<br/>`trigger` (cancel_start_fresh) | v0.45.25 (2025-11-14) | |
| `known_error` | Various (see Known Error IDs below) | A recognized error condition occurs that we want to track and monitor | `errorId` (see Known Error IDs)<br/>`context` (where the error occurred)<br/>`errorMessage` (optional, truncated) | (pending release as of c597008b) | |
| `feature_first_use` | `AIService.ts:406`<br/>`WindowManager.ts:230`<br/>`AnalyticsHandlers.ts:45` | User uses a feature for the first time | `feature`<br/>`daysSinceInstall` | v0.45.25 (2025-11-14) | |

#### Known Error IDs

The `known_error` event uses an `errorId` property to identify specific error conditions. This allows us to track patterns of known issues without creating a separate event for each one.

| Error ID | File(s) | Description | Additional Properties |
| --- | --- | --- | --- |
| `pglite_wasm_runtime_crash` | `index.ts:418` | PGLite WASM runtime crashed during database initialization (often resolved by restarting computer) | `context`: database_initialization |
| `database_initialization_failed` | `index.ts:424` | Database initialization failed for unknown reasons | `context`: database_initialization<br/>`errorMessage`: truncated error |

### Onboarding & Walkthrough

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `feature_walkthrough_completed` | `FeatureWalkthrough.tsx:76, 102` | User completes or skips the feature walkthrough | `total_time_ms`<br/>`slide_times` (object with editor/agent/mockup keys)<br/>`skipped` (boolean)<br/>`skipped_at_slide` (editor/agent/mockup, only if skipped) | v0.45.25 (2025-11-14) | |
| `onboarding_completed` | `App.tsx:312` | User completes the role/email onboarding dialog | `user_role`<br/>`custom_role_provided`<br/>`custom_role_text`<br/>`email_provided` | v0.45.25 (2025-11-14) | |
| `onboarding_deferred` | `App.tsx:330` | User clicks "Ask me later" on onboarding dialog | None | v0.45.25 (2025-11-14) | |
| `onboarding_skipped` | `App.tsx:341` | User clicks "Never ask again" on onboarding dialog | None | v0.45.25 (2025-11-14) | |
| `claude_commands_toast_shown` | `App.tsx:894` | Claude commands install toast is displayed | None | v0.47.2 (2025-12-10) | |
| `claude_commands_toast_install_all` | `App.tsx:1654` | User clicks "Install All" on commands toast | None | v0.47.2 (2025-12-10) | |
| `claude_commands_toast_settings` | `App.tsx:1663` | User clicks "Settings" on commands toast | None | v0.47.2 (2025-12-10) | |
| `claude_commands_toast_skip` | `App.tsx:1673` | User clicks "Skip" on commands toast | None | v0.47.2 (2025-12-10) | |

### Surveys & Feedback

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `survey shown` | `PostHogSurvey.tsx:85` | PostHog API survey is displayed to user | `$survey_id`<br/>`$survey_name` | (pending release) | |
| `survey dismissed` | `PostHogSurvey.tsx:95` | User dismisses survey without submitting | `$survey_id`<br/>`$survey_name` | (pending release) | |
| `survey sent` | `PostHogSurvey.tsx:122` | User submits survey response | `$survey_id`<br/>`$survey_name`<br/>`$survey_response` (single question)<br/>`$survey_response_N` (multi-question) | (pending release) | |

### Permissions

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `agent_permissions_opened` | `ProjectPermissionsPanel.tsx:75` | User opens the agent permissions settings panel | `isTrusted`<br/>`permissionMode`<br/>`allowedPatternsCount`<br/>`additionalDirectoriesCount` | (pending release as of d00c15df) | |
| `permission_setting_changed` | `ProjectPermissionsPanel.tsx` | User changes any permission setting | `action` (trust_workspace/revoke_trust/change_mode/remove_pattern/reset_to_defaults/add_directory/remove_directory/add_url_pattern/remove_url_pattern/allow_all_domains/revoke_all_domains)<br/>`mode` (only for change_mode action) | (pending release as of d00c15df) | |
| `tool_permission_responded` | `AISessionView.tsx:536` | User responds to tool permission dialog | `decision` (allow/deny)<br/>`scope` (once/session/always/always-all)<br/>`toolCategory` (bash/webfetch/mcp/file/other) | (pending release as of d00c15df) | |
| `trust_dialog_saved` | `ProjectTrustToast.tsx:151` | User saves trust choice in dialog | `permissionMode` (ask/allow-all/bypass-all)<br/>`isChangingMode` | (pending release as of d00c15df) | |

### Special System Events

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `nimbalyst_session_start` | `AnalyticsService.ts:154` | Application starts (sent even for opted-out users) | `$session_id`<br/>`has_git_installed`<br/>`nimbalyst_version`<br/>`$set_once: is_dev_user`<br/>`$set_once: is_dev_install` | v0.45.25 (2025-11-14) | |
| `analytics_opt_out` | `AnalyticsService.ts:89` | User opts out of analytics in settings | None | v0.45.25 (2025-11-14) | |
| `first_launch_claude_check` | `index.ts:114` | Very first app launch only - checks if Claude Code is installed | `hasClaudeInstalled` (boolean) | v0.47.2 (2025-12-10) | |
| `quit_confirmation_shown` | `index.ts:757` | User attempts quit with active AI session | `reason` (active_ai_session) | v0.45.25 (2025-11-14) | |
| `quit_confirmation_result` | `index.ts:774, 783` | User responds to quit confirmation dialog | `result` (quit_anyway/cancelled) | v0.45.25 (2025-11-14) | |

### Voice Mode

| Event Name | File(s) | Trigger | Properties | First Added (Public) | Significant Changes |
| --- | --- | --- | --- | --- | --- |
| `voice_session_started` | `VoiceModeService.ts:259` | Voice session connects | None | (pending release) | |
| `voice_session_ended` | `VoiceModeService.ts:36` | Voice session disconnects | `reason` (user_stopped/timeout/error)<br/>`durationCategory` (short/medium/long) | (pending release) | |
| `voice_prompt_submitted` | `RealtimeAPIClient.ts:390` | Voice assistant submits prompt to coding agent | None | (pending release) | |

## Event Summary Statistics

- **Total Events**: 79 unique event names
- **Main Process Events**: 44 (via AnalyticsService)
- **Renderer Process Events**: 35 (via usePostHog hook)
- **File Operations**: 7 events
- **Workspace Operations**: 4 events
- **Navigation & Editor Mode**: 3 events
- **File History**: 2 events
- **AI-Related**: 20 events
- **MCP Configuration**: 3 events
- **Terminal**: 1 event
- **Extensions**: 1 event
- **Onboarding**: 8 events
- **Surveys & Feedback**: 3 events
- **Permissions**: 4 events
- **Voice Mode**: 3 events
- **System/Infrastructure**: 11 events

## Privacy Requirements

All events MUST follow these privacy rules:

1. **Never include PII**: No usernames, emails, IP addresses, or identifying information
2. **No file paths**: Use categories/buckets instead of actual paths
3. **No API keys**: Never include authentication tokens or credentials
4. **Anonymous distinctId**: Use auto-generated anonymous ID, never override
5. **Categorical properties**: Use bucketed values (small/medium/large) instead of exact values

## Development vs Production

- **Dev users**: Automatically marked with `is_dev_user: true` property (via `$set_once`)
- **Dev builds**: Any non-official build (local builds, development mode)
- **Official builds**: Created by GitHub release workflow with `OFFICIAL_BUILD=true`
- **Filtering**: Use `WHERE is_dev_user != true` in PostHog to exclude dev users

## Adding New Events

When adding new events:

1. **Choose the right context**: Main process (AnalyticsService) or renderer (usePostHog)
2. **Follow naming conventions**: Use `snake_case`, `noun_verb` pattern
3. **Use categorical properties**: Bucket values instead of exact numbers
4. **Update this document**: Add the event to the appropriate table with version columns:
   - Set "First Added (Public)" to `(pending release as of <commit-hash>)` until publicly released
   - Leave "Significant Changes" empty for new events
5. **Document in code**: Add comment explaining what the event tracks
6. **When modifying events**: Add entry to "Significant Changes" column (see Version Tracking section)

## Reference Documentation

- Analytics implementation guide: `docs/ANALYTICS_GUIDE.md`
- AnalyticsService: `packages/electron/src/main/services/analytics/AnalyticsService.ts`
- Privacy requirements: See ANALYTICS_GUIDE.md "Critical Privacy Requirements"
