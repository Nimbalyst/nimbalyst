# Diff Scenario Results

## Run 1 (Fail)
- Token: `actualdelta-1771968803`
- Result: **FAIL**
- Failure:
  - `item_23` (`file_change` update of existing file) returned empty from `session-files:get-tool-call-diffs` despite real content delta.
- Key evidence:
  - `session_files` had no `toolUseId=item_23` entry for the updated file.
  - `document_history` pending tag for existing apply file was not reliably associated with the update event.

## Changes Applied
- `packages/electron/src/main/services/SessionFileTracker.ts`
  - Edited-file dedupe key changed from `sessionId:filePath` to `sessionId:filePath:toolUseId`.
- `packages/electron/src/main/services/ai/AIService.ts`
  - For Codex `file_change`, preserve provider item ID as `toolUseId` so per-tool diff lookup can key by item ID.
  - Proactive pre-edit tags now prefer `chunk.toolCall.id` as `toolUseId`.
  - Keep stale-baseline guard (skip proactive tag when baseline equals current disk content).
- `packages/electron/src/main/HistoryManager.ts`
  - Treat both unique-index names (`idx_history_pending_pre_edit_per_file` and `idx_history_one_pending_per_file`) as expected duplicate-tag races.

## Run 2 (Pass)
- Token: `actualdelta-1771969281`
- Result: **PASS**
- `session-files:get-tool-call-diffs`:
  - `item_5` (new apply add): non-empty diff
  - `item_6` (existing apply add): non-empty diff
  - `item_7` (existing apply update): non-empty diff
  - `item_8` (bash create+mutate): non-empty diff
- `session_files` now includes `toolUseId` rows for all four item IDs (`item_5`, `item_6`, `item_7`, `item_8`).

## Notes
- `ai_tool_call_file_edits` remains best-effort for Codex because item IDs are reused across turns.
- The diff UI path now remains reliable via `session_files.metadata.toolUseId` + timestamp-anchored lookup in `get-tool-call-diffs`.
