# Diff Tracking Scenario (Actual Delta Aware)

## Purpose
Verify that Codex/Nimbalyst only reports file diffs when there is an actual content delta, and always reports diffs when delta exists, including for newly created files.

## Preconditions
- Nimbalyst running in development mode.
- Use current AI session only.
- Use a unique token per run: `actualdelta-<unix-timestamp>`.

## Files
- `NEW_APPLY_FILE`: `analysis/codex-diff-<TOKEN>-new-apply.txt`
- `EXISTING_APPLY_FILE`: `analysis/codex-diff-<TOKEN>-existing-apply.txt`
- `BASH_FILE`: `analysis/codex-diff-<TOKEN>-bash.txt`

## Test Actions
1. `apply_patch` create `NEW_APPLY_FILE` with:
   ```
   n1
   n2
   n3
   ```
2. `apply_patch` create `EXISTING_APPLY_FILE` with:
   ```
   e1
   e2
   e3
   ```
3. `apply_patch` edit `EXISTING_APPLY_FILE`: change `e2` -> `e2-updated`.
4. Bash edit `BASH_FILE` in one command: create with `b1,b2,b3` then mutate `b2 -> b2-updated`.

## Evidence Queries (required)
For each file above, capture:
1. `session_files` rows (`toolName`, `operation`, `toolUseId`, `timestamp`).
2. `document_history` latest `pre-edit` row (`status`, `toolUseId`).
3. `ai_tool_call_file_edits` rows joined through `session_file_id`.
4. `ai_agent_messages` command/file_change records for the token.
5. `session-files:get-tool-call-diffs(sessionId, toolCallItemId, toolCallTimestamp)` results.
6. `history:getPendingTags(filePath)` and current disk file content.

## Actual Delta Rule
For each tool call + file pair, define:
- `baseline = pendingTag.content` (or latest pending pre-edit content)
- `current = disk content`
- `hasActualDelta = baseline !== current`

## Expected Outcomes
- If `hasActualDelta = true`:
  - There must be a `pending-review` `pre-edit` tag.
  - `session-files:get-tool-call-diffs` must return at least one diff entry for that exact tool call + file.
- If `hasActualDelta = false`:
  - Empty diff output is acceptable.
  - No pending-review tag is acceptable.

## Pass/Fail Checks
1. `item_19` (`file_change` add `NEW_APPLY_FILE`) should satisfy rule above.
2. `item_21` (`file_change` add `EXISTING_APPLY_FILE`) should satisfy rule above.
3. `item_23` (`file_change` update `EXISTING_APPLY_FILE`) should satisfy rule above.
4. `item_25` (`Bash` mutation of `BASH_FILE`) should satisfy rule above.
5. For each non-empty tool diff output, there must be matching DB linkage in `ai_tool_call_file_edits` OR `session_files.metadata.toolUseId` used by `get-tool-call-diffs`.

Run fails if any file violates Actual Delta Rule.
