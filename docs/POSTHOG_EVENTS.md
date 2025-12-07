# PostHog Events Reference

This document catalogs all PostHog analytics events tracked in Nimbalyst. **This document MUST be updated whenever PostHog events are added, modified, or removed.**

## Overview

Nimbalyst uses PostHog for anonymous usage analytics with two tracking contexts:
- **Main Process**: Server-side events via `AnalyticsService.getInstance().sendEvent()`
- **Renderer Process**: Client-side events via `usePostHog()` hook from posthog-js/react

All events include `$session_id` property automatically. Dev users are marked with `is_dev_user: true` via `$set_once`.

## Events Catalog

### File Operations

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `file_opened` | `FileHandlers.ts:85`<br/>`WorkspaceHandlers.ts:804` | User opens file via dialog or workspace tree | `source` (dialog/workspace)<br/>`fileType`<br/>`hasWorkspace` |
| `file_saved` | `FileHandlers.ts:199` | User manually saves file (Cmd+S) | `saveType` (manual)<br/>`fileType`<br/>`hasFrontmatter`<br/>`wordCount` |
| `file_save_failed` | `FileHandlers.ts:212, 277` | File save operation fails | `errorType`<br/>`fileType`<br/>`isAutoSave` |
| `file_conflict_detected` | `FileHandlers.ts:138` | File changed on disk since last load | `fileType`<br/>`conflictResolution` (pending) |
| `file_created` | `FileHandlers.ts:399`<br/>`WorkspaceHandlers.ts:154` | User creates new file | `creationType` (new_file_menu/ai_tool)<br/>`fileType` (markdown/mockup/text/other) |
| `file_renamed` | `WorkspaceHandlers.ts:592` | User renames file in workspace | None |
| `file_deleted` | `WorkspaceHandlers.ts:618` | User deletes file from workspace | None |

### Workspace Operations

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `workspace_opened` | `SessionState.ts:122`<br/>`index.ts:406`<br/>`WorkspaceManagerWindow.ts:292` | Workspace opened from startup, CLI, or dialog | `fileCount` (1-10, 11-50, 51-100, 100+)<br/>`hasSubfolders`<br/>`source` (startup_restore/cli) |
| `workspace_opened_with_filter` | `index.ts:433` | Workspace opened with git-worktree filter | `filter` (git-worktree)<br/>`$set_once: ever_opened_direct_to_worktree` |
| `workspace_file_tree_expanded` | `WorkspaceWatcher.ts:53` | File tree expands with new files detected | `depth`<br/>`fileCount` (0-10, 11-50, 51-100, 100+) |
| `workspace_search_used` | `QuickOpen.tsx:130, 230` | User searches workspace (files or content) | `resultCount` (0-4, 5-9, 10-49, 50-99, 100+)<br/>`queryLength` (1, 2-3, 4-9, 10+)<br/>`searchType` (file_name/content) |

### Theme Management

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `theme_changed` | `ApplicationMenu.ts:848, 877, 906, 937` | User selects theme from Window > Theme menu | `theme` (light/dark/crystal-dark/system) |

### AI Chat & Sessions

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `create_ai_session` | `AIService.ts:455` | User creates new AI chat session | `provider` |
| `ai_message_sent` | `AIService.ts:1436` | User sends message in AI chat | `provider`<br/>`hasDocumentContext`<br/>`hasAttachments`<br/>`usedSlashCommand` (optional)<br/>`slashCommandName` (optional)<br/>`slashCommandPackageId` (optional) |
| `ai_response_received` | `AIService.ts:1092, 1326` | AI provider returns response | `provider`<br/>`responseType` (text/tool_use/error)<br/>`toolsUsed` |
| `ai_response_streamed` | `AIService.ts:1100` | AI response finishes streaming | `provider`<br/>`chunkCount` (0-9, 10-49, 50-99, 100+)<br/>`totalLength` (0-99, 100-499, 500-999, 1000+) |
| `ai_stream_interrupted` | `AIService.ts:1024, 1483` | AI streaming stops prematurely | `provider`<br/>`chunksReceived`<br/>`reason` (error/user_cancel) |
| `ai_request_failed` | `AIService.ts:1319` | AI API request fails | `provider`<br/>`errorType` (network/auth/timeout/rate_limit/overloaded/unknown)<br/>`retryAttempt` |
| `ai_session_resumed` | `AIService.ts:1382` | User resumes previous AI session | `provider`<br/>`messageCount` (0, 1, 2-4, 5-9, 10+)<br/>`ageInDays` (today/1-day/2-6-days/1-4-weeks/1-3-months/3-months-plus) |
| `cancel_ai_request` | `AIService.ts:1491` | User cancels active AI request | `provider` |
| `ai_diff_accepted` | `DiffApprovalBar.tsx:315, 436` | User accepts diff or all diffs | `acceptType` (partial/all)<br/>`replacementCount` |
| `ai_diff_rejected` | `DiffApprovalBar.tsx:380, 450` | User rejects diff or all diffs | `rejectType` (partial/all)<br/>`replacementCount` |

### Claude Code (MCP)

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `claude_code_session_started` | `AIService.ts:1178` | Claude Code provider initializes session | `mcpServerCount`<br/>`slashCommandCount`<br/>`agentCount` |
| `slash_command_suggestion_clicked` | `SlashCommandSuggestions.tsx:117` | User clicks a slash command suggestion pill in empty session | `commandName`<br/>`packageId` |

### AI Tool Execution

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `apply_diff_tool` | `ToolExecutor.ts:55` | AI applies diff/code replacement via tool | None |
| `ai_stream_content_used` | `ToolExecutor.ts:115` | AI streams content to document via tool | None |
| `create_document_tool` | `ToolExecutor.ts:245` | AI creates new document via tool | None |
| `execute_custom_tool` | `ToolExecutor.ts:358` | AI executes custom MCP tool | None |

### AI Configuration

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `ai_provider_configured` | `GlobalSettingsScreen.tsx:276` | User enables/disables AI provider in settings | `provider`<br/>`modelCount`<br/>`action` (enabled/disabled) |
| `ai_model_selected` | `GlobalSettingsScreen.tsx:377` | User selects specific AI model | `provider`<br/>`modelName` |

### Attachments

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `add_attachment` | `AttachmentService.ts:112` | User attaches file to AI chat message | None |
| `delete_attachment` | `AttachmentService.ts:148` | User removes attachment from message | None |

### Project Settings & Packages

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `project_settings_opened` | `ProjectSettingsScreen.tsx:55` | User opens project settings screen | `isFirstTime`<br/>`totalPackages`<br/>`installedPackages` |
| `package_installed` | `ProjectSettingsScreen.tsx:79` | User successfully installs package | `packageId`<br/>`packageName` |
| `package_install_failed` | `ProjectSettingsScreen.tsx:91` | Package installation fails | `packageId`<br/>`error` |
| `package_uninstalled` | `ProjectSettingsScreen.tsx:116` | User successfully uninstalls package | `packageId`<br/>`packageName` |
| `package_uninstall_failed` | `ProjectSettingsScreen.tsx:128` | Package uninstallation fails | `packageId`<br/>`error` |

### Menu & Application

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `menu_action_used` | `ApplicationMenu.ts:476, 968` | User clicks certain menu items | Varies by menu item |
| `global_settings_opened` | `ApplicationMenu.ts:517, 1282`<br/>`AIModelsWindow.ts:50` | User opens global settings or AI models window | None |
| `help_accessed` | `ApplicationMenu.ts:1336, 1348, 1363, 1381, 1396, 1408, 1423` | User clicks help menu items | Varies by help item |
| `keyboard_shortcut_used` | `AnalyticsHandlers.ts:29` | User triggers keyboard shortcut (reported from renderer) | `shortcut`<br/>`context` |
| `toolbar_button_clicked` | `AnalyticsHandlers.ts:37` | User clicks toolbar button (reported from renderer) | `button`<br/>`isFirstUse` |

### System & Database

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `database_error` | `PGLiteDatabaseWorker.ts:255, 275` | Database operation fails | `operation` (read/write)<br/>`errorType`<br/>`tableName` |
| `database_corruption_detected` | `PGLiteDatabaseWorker.ts:131` | Database corruption detected during initialization | `hasBackups` |
| `database_corruption_recovery_choice` | `PGLiteDatabaseWorker.ts:153, 215, 222, 272` | User makes a choice in database corruption recovery dialog | `choice` (restore_from_backup/start_fresh/auto_fresh)<br/>`confirmed` (for start_fresh)<br/>`reason` (for auto_fresh) |
| `database_corruption_restore_result` | `PGLiteDatabaseWorker.ts:165, 185, 232, 253` | Result of attempting to restore from backup | `success`<br/>`source` (current/previous)<br/>`errorType` (verification_failed/restore_failed)<br/>`trigger` (cancel_start_fresh) |
| `feature_first_use` | `AIService.ts:406`<br/>`WindowManager.ts:230`<br/>`AnalyticsHandlers.ts:45` | User uses a feature for the first time | `feature`<br/>`daysSinceInstall` |

### Onboarding & Walkthrough

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `feature_walkthrough_completed` | `FeatureWalkthrough.tsx:76, 102` | User completes or skips the feature walkthrough | `total_time_ms`<br/>`slide_times` (object with editor/agent/mockup keys)<br/>`skipped` (boolean)<br/>`skipped_at_slide` (editor/agent/mockup, only if skipped) |
| `onboarding_completed` | `App.tsx:312` | User completes the role/email onboarding dialog | `user_role`<br/>`custom_role_provided`<br/>`custom_role_text`<br/>`email_provided` |
| `onboarding_deferred` | `App.tsx:330` | User clicks "Ask me later" on onboarding dialog | None |
| `onboarding_skipped` | `App.tsx:341` | User clicks "Never ask again" on onboarding dialog | None |

### Special System Events

| Event Name | File(s) | Trigger | Properties |
| --- | --- | --- | --- |
| `nimbalyst_session_start` | `AnalyticsService.ts:135` | Application starts (sent even for opted-out users) | `$session_id`<br/>`nimbalyst_version`<br/>`$set_once: is_dev_user`<br/>`$set_once: is_dev_install` |
| `analytics_opt_out` | `AnalyticsService.ts:89` | User opts out of analytics in settings | None |
| `first_launch_claude_check` | `index.ts:114` | Very first app launch only - checks if Claude Code is installed | `hasClaudeInstalled` (boolean) |

## Event Summary Statistics

- **Total Events**: 51 unique event names
- **Main Process Events**: 37 (via AnalyticsService)
- **Renderer Process Events**: 14 (via usePostHog hook)
- **File Operations**: 7 events
- **Workspace Operations**: 4 events
- **AI-Related**: 20 events
- **Onboarding**: 4 events
- **System/Infrastructure**: 9 events

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
4. **Update this document**: Add the event to the appropriate table
5. **Document in code**: Add comment explaining what the event tracks

## Reference Documentation

- Analytics implementation guide: `docs/ANALYTICS_GUIDE.md`
- AnalyticsService: `packages/electron/src/main/services/analytics/AnalyticsService.ts`
- Privacy requirements: See ANALYTICS_GUIDE.md "Critical Privacy Requirements"
