---
name: update-libs
description: Update Anthropic Agent SDK, MCP library, and Codex SDK to latest versions
---
Update the Anthropic Agent SDK, MCP library, and OpenAI Codex SDK to their latest versions.

**This command is always a two-phase execution.** Phase 1 evaluates the available updates and reports impact. Then STOP and wait for explicit user direction before starting Phase 2 (the actual upgrade). Do not perform any package.json edits, `npm install`, or commits in Phase 1.

## Libraries to Update

1. **@anthropic-ai/claude-agent-sdk** - Located in root `package.json` (also pinned in `overrides`)
2. **@modelcontextprotocol/sdk** - Located in `packages/electron/package.json`
3. **@openai/codex-sdk** - Located in `packages/runtime/package.json`

---

## Phase 1: Evaluation (always run first)

Goal: tell the user what would change and what to consider, without modifying anything.

1. **Check current versions** by reading the package.json files (root, `packages/electron`, `packages/runtime`). Also note the `overrides` pin for `@anthropic-ai/claude-agent-sdk` in the root `package.json`.
2. **Fetch latest versions** from npm:
  - `npm view @anthropic-ai/claude-agent-sdk version`
  - `npm view @modelcontextprotocol/sdk version`
  - `npm view @openai/codex-sdk version`
  - Use `npm view <pkg> versions --json` to enumerate the intermediate versions between current and latest.
3. **Get changelogs** for the gap between current and latest:
4. **Assess actual impact on Nimbalyst** — do not just dump changelog text. For each non-trivial change, check whether our code path is affected:
5. **Get changelogs** for all packages:
6. **Report findings** in the output format below. Each library section must include both the changelog summary and a Nimbalyst-specific impact assessment with risk level (Low / Medium / High).
7. **Surface upgrade-time considerations** — call these out explicitly in a "Things to consider" section:
  - Native binary integrity: both SDKs ship platform binaries via `extraResources`/`optionalDependencies`. Past incidents (`feedback_extraresources_vs_files_globs.md`, `feedback_windows_arm64_install_scripts.md`) show npm silently skips these on stale integrity hashes.
  - The `overrides` pin for `@anthropic-ai/claude-agent-sdk` in root `package.json` must be bumped in lockstep or the upgrade is silently neutered.
  - `peer: true` flags in `package-lock.json` for optional native deps can get stripped by `npm install` (see global CLAUDE.md note).
  - Per project memory: never bump `TranscriptTransformer.CURRENT_VERSION` as part of an SDK upgrade.
  - Per project memory: don't revert `@anthropic-ai/claude-agent-sdk` past 0.2.113.
  - Hardcoded model defaults that may be affected by model-catalog refreshes (e.g., `model: 'gpt-5'` in `CodexSDKProtocol.ts`).
  - Smoke-test scope to recommend before shipping.
7. **STOP.** End your turn with an explicit prompt asking the user whether to proceed with Phase 2, all libraries or a subset. Do not edit files, do not run `npm install`, do not commit. Wait for the user's response.

If any package is already at the latest version, note that no update is needed for it and exclude it from the Phase 2 plan you propose.

## Output Format for Phase 1

### @anthropic-ai/claude-agent-sdk
- **Current**: [version] (root `overrides`: [version])
- **Latest**: [version]
- **Versions in gap**: [list]
- **Changes**: [bulleted summary, grouped by version]
- **Nimbalyst impact**: [risk: Low/Medium/High] [what we use, what's affected, what isn't]

### @modelcontextprotocol/sdk
- **Current**: [version]
- **Latest**: [version]
- **Changes**: [...]
- **Nimbalyst impact**: [...]

### @openai/codex-sdk
- **Current**: [version]
- **Latest**: [version]
- **Versions in gap**: [list]
- **Changes**: [...]
- **Nimbalyst impact**: [...]

### Things to consider
- [Native binary integrity check items]
- [Override pin reminder]
- [Hardcoded defaults that may need verification]
- [Smoke-test scope]
- [Recommendation: upgrade all together, stagger, or defer one]

### Awaiting direction
End with a question like: "Proceed with Phase 2? You can choose all three, a subset, or defer."

---

## Phase 2: Implementation (only after user confirms)

Do not start this phase until the user has explicitly approved the upgrade and indicated which packages to upgrade. The user may opt to upgrade only a subset (e.g. claude-agent-sdk only, defer codex-sdk).

1. **Update versions** in the respective package.json files:
  - `@anthropic-ai/claude-agent-sdk`: update both the workspace dependency entries AND the `overrides` pin in root `package.json` (use exact version, no caret, for the override).
  - `@modelcontextprotocol/sdk`: in `packages/electron/package.json` (caret prefix).
  - `@openai/codex-sdk`: in `packages/runtime/package.json` and `packages/electron/package.json` if present (caret prefix).
8. **Run \****`npm install`** at the repository root to update `package-lock.json`.
9. **Verify** with `npm ls <package-name>` for each updated package. If npm reports `invalid` (lock file still resolves the old version despite the package.json change):
  - Remove the stale package directories from `node_modules/` (including transitive deps like `@openai/codex` for `@openai/codex-sdk`).
  - Use `npm view <package>@<version> --json` to get the new `integrity`, `resolved` URL, and `dependencies`.
  - Edit `package-lock.json` to update the `version`, `resolved`, `integrity`, and `dependencies` for the package AND its transitive deps.
  - Re-run `npm install` and verify again with `npm ls`.
9. **Verify Codex platform binaries installed** — `@openai/codex-sdk` depends on `@openai/codex`, which has optional platform-specific binary packages (e.g., `@openai/codex-darwin-arm64`). npm silently skips these if their integrity hashes are wrong. Check:
  - `ls node_modules/@openai/codex-darwin-arm64/vendor/` (or the appropriate host platform) to confirm the binary exists.
  - If missing: run `npm install @openai/codex-sdk@<version> --workspace=packages/electron --workspace=packages/runtime` to regenerate hashes, then verify again.
5. **Verify claude-agent-sdk platform binaries installed** — same risk applies. Check `node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/` (or host platform) exists.
6. **Verify \****`peer: true`**\*\* preservation** — diff `package-lock.json` for any `peer: true` flags that were stripped on optional native deps. If stripped, restore them before committing (see global CLAUDE.md and `peer: true` policy).
7. **Commit the changes** — create a git commit with the updated dependencies. Summarize which packages were updated and their version changes (e.g., "deps: update claude-agent-sdk 0.2.117 -> 0.2.121, codex-sdk 0.121.0 -> 0.125.0"). Stage only: `package.json`, `packages/electron/package.json`, `packages/runtime/package.json`, and `package-lock.json`. Do not skip hooks. Do not add Co-Authored-By lines.
  - Grep our usage of each SDK before declaring impact (`from '@anthropic-ai/claude-agent-sdk'`, `from '@openai/codex-sdk'`, MCP SDK imports).
  - For deprecations: confirm via Grep whether we use the deprecated symbol. If we don't, say so explicitly.
  - For new options: note whether we currently pass that option in `sdkOptionsBuilder.ts`, `CodexSDKProtocol.ts:buildThreadOptions`, etc.
  - For internal refactors (especially in Codex): identify whether they touch the SDK API surface we consume (`query()`, `client.startThread()`, `client.resumeThread()`, options shape) vs. internal-only changes.
  - **claude-agent-sdk**: fetch the SDK changelog at https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md. If entries say "brought up to CLI version X.Y.Z", also fetch the Claude Code CLI changelog at https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md for those CLI versions.
  - **MCP SDK**: fetch https://github.com/modelcontextprotocol/typescript-sdk/releases.
  - **Codex SDK**: use `gh release view rust-v<version> --repo openai/codex --json body` for each version in the gap (the npm `@openai/codex-sdk` releases are tagged `rust-v<version>` in the openai/codex repo). The npm page returns 403 to WebFetch, so don't waste a call there.
