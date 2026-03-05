---
name: update-libs
description: Update Anthropic Agent SDK, MCP library, and Codex SDK to latest versions
---
Update the Anthropic Agent SDK, MCP library, and OpenAI Codex SDK to their latest versions, showing changelogs.

## Libraries to Update

1. **@anthropic-ai/claude-agent-sdk** - Located in root `package.json`
2. **@modelcontextprotocol/sdk** - Located in `packages/electron/package.json`
3. **@openai/codex-sdk** - Located in `packages/runtime/package.json`

## Steps

1. **Check current versions** by reading the package.json files
2. **Fetch latest versions** from npm:
  - Run `npm view @anthropic-ai/claude-agent-sdk version` to get latest
  - Run `npm view @modelcontextprotocol/sdk version` to get latest
  - Run `npm view @openai/codex-sdk version` to get latest
3. **Get changelogs** for all packages:
  - For claude-agent-sdk: Fetch https://github.com/anthropics/claude-code/releases to find changes between current and latest. **Important**: The SDK changelog often just says "brought up to CLI version X.Y.Z" - in these cases, also fetch the Claude Code CLI changelog at https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md to get the actual feature/fix details for those CLI versions.
  - For MCP SDK: Fetch https://github.com/modelcontextprotocol/typescript-sdk/releases to find changes between current and latest
  - For Codex SDK: Fetch https://github.com/openai/openai-codex-sdk/releases or https://www.npmjs.com/package/@openai/codex-sdk to find changes between current and latest
4. **Report the changes** - Show what changed between the current version and latest for each library. For the Agent SDK, include relevant CLI changes that affect the SDK.
5. **Update the versions** in the respective package.json files:
  - Update `@anthropic-ai/claude-agent-sdk` version in root `package.json` (use exact version, no caret)
  - Update `@modelcontextprotocol/sdk` version in `packages/electron/package.json` (use caret prefix)
  - Update `@openai/codex-sdk` version in `packages/runtime/package.json` (use caret prefix)
6. **Run npm install** at the repository root to update package-lock.json
7. **Verify** the updates were successful by running `npm ls <package-name>` for each updated package. If npm reports `invalid` (lock file still resolves the old version despite the package.json change), you must:
  - Remove the stale package directories from `node_modules/` (including transitive deps like `@openai/codex` for `@openai/codex-sdk`)
  - Use `npm view <package>@<version> --json` to get the new `integrity`, `resolved` URL, and `dependencies`
  - Edit `package-lock.json` to update the `version`, `resolved`, `integrity`, and `dependencies` for the package AND its transitive deps
  - Re-run `npm install` and verify again with `npm ls`
8. **Verify Codex platform binaries installed** - The `@openai/codex-sdk` depends on `@openai/codex`, which has optional platform-specific binary packages (e.g., `@openai/codex-darwin-arm64`). npm silently skips these if their integrity hashes are wrong. Check:
  - Run `ls node_modules/@openai/codex-darwin-arm64/vendor/` (or the appropriate platform) to confirm the binary exists
  - If missing, the integrity hashes in `package-lock.json` are likely stale. Run `npm install @openai/codex-sdk@<version> --workspace=packages/electron --workspace=packages/runtime` to regenerate them
  - Verify again that the platform binary directory exists after reinstall
9. **Commit the changes** - Create a git commit with the updated dependencies. The commit message should summarize which packages were updated and their version changes (e.g., "deps: update claude-agent-sdk 1.0.0 -> 1.1.0, mcp-sdk 2.0.0 -> 2.1.0"). Stage only the relevant files: `package.json`, `packages/electron/package.json`, `packages/runtime/package.json`, and `package-lock.json`.

## Output Format

Present the findings in this format:

### @anthropic-ai/claude-agent-sdk
- **Current**: [version]
- **Latest**: [version]
- **Changes**:
  - [List notable changes from release notes]

### @modelcontextprotocol/sdk
- **Current**: [version]
- **Latest**: [version]
- **Changes**:
  - [List notable changes from release notes]

### @openai/codex-sdk
- **Current**: [version]
- **Latest**: [version]
- **Changes**:
  - [List notable changes from release notes]

If any package is already at the latest version, note that no update is needed.
