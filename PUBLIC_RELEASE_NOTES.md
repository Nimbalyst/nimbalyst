# Nimbalyst v0.58.12

This release covers everything since v0.58.4: open-source licensing, agent self-pacing, a guided in-app feedback flow, OpenCode improvements, and a stack of polish fixes across AI, diff, and history surfaces.

### New Features

- **Open source under MIT.** The Nimbalyst app is now MIT-licensed.
- **Schedule Wakeups.** Agents can now schedule their own check-ins via the `schedule_wakeup` tool to check on long running tasks. Wakeups persist across app restarts (only fire while Nimbalyst is running), surface.
- **Guided in-app feedback.** Help > Send Feedback now opens a guided agent that helps you draft bug reports and feature requests, gather logs (with consent), anonymize sensitive content, and post directly to Nimbalyst's GitHub Issues. Replaces the old in-app survey.
- **GPT-5.5** added to OpenAI Codex and Chat model catalogs.

### 
### Fixed

- **Stable terminal bottom panel across reloads.** Preserves screen state and cursor, avoids destructive scrollback loss and panel hydration races.
- **AI red/green diff stays put on open files.** Two races could clobber the in-flight diff or apply the same tag twice, making green-addition decorations disappear while deletions still rendered red. Both paths now coalesce correctly so the diff in flight wins.
- **`@@`**** session typeahead matches the session list visuals.** Renders the actual provider icon (Claude, OpenAI, Codex, etc.) for each referenced session instead of a generic chat bubble, with a colored phase badge matching the main session list.
- **Referenced/Edited file lists remember their collapsed state.** They used to reset to expanded on every chat remount; now persisted per gutter type to workspace state.
- **Monaco diff gutter glyphs render correctly.** The codicon font was failing to load, so `+`/`-` markers showed as tofu boxes on changed lines. Also restyles the diff gutter with faint line numbers, generous spacing, and clearer add/remove markers.
- **History dialog diff preview no longer hangs.** When a snapshot loads as null/empty or its metadata is missing, the spinner now clears instead of hanging indefinitely. The Rich/Raw view toggle is promoted to the top header for markdown files in both Diff and Full modes.
- **"Waiting for input" indicator survives mode switches.** Navigating away from Agent mode and back used to regress the question-mark indicator to a running spinner even when the AI was still blocked on user input.
- **AskUserQuestion drafts persist across unmounts.** Selections, the "Other" toggle, and "Other" text were lost when switching AI sessions or when the transcript's virtual scroller unmounted the widget off-screen. Now held in a per-prompt atom family.
- **`@`**** mention picker shows recent files first.** When the AI input's `@` typeahead opens with an empty query, recently viewed files appear instead of the alphabetical top-level listing. Once you type, fuzzy search takes over.
- **MIME types for chat attachments.** `.log`, `.ts`, `.py`, `.yaml`, and ~70 other text-based extensions are now recognized correctly when dragged into chat (browsers report empty/`octet-stream` for these).