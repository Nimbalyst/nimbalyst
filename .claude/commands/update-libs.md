---
name: update-libs
description: Update Anthropic Agent SDK and MCP library to latest versions
---
Update the Anthropic Agent SDK and MCP library to their latest versions, showing changelogs.

## Libraries to Update

1. **@anthropic-ai/claude-agent-sdk** - Located in root `package.json`
2. **@modelcontextprotocol/sdk** - Located in `packages/electron/package.json`

## Steps

1. **Check current versions** by reading the package.json files
2. **Fetch latest versions** from npm:
  - Run `npm view @anthropic-ai/claude-agent-sdk version` to get latest
  - Run `npm view @modelcontextprotocol/sdk version` to get latest
3. **Get changelogs** for both packages:
  - For claude-agent-sdk: Fetch https://github.com/anthropics/claude-code/releases to find changes between current and latest. **Important**: The SDK changelog often just says "brought up to CLI version X.Y.Z" - in these cases, also fetch the Claude Code CLI changelog at https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md to get the actual feature/fix details for those CLI versions.
  - For MCP SDK: Fetch https://github.com/modelcontextprotocol/typescript-sdk/releases to find changes between current and latest
4. **Report the changes** - Show what changed between the current version and latest for each library. For the Agent SDK, include relevant CLI changes that affect the SDK.
5. **Update the versions** in the respective package.json files:
  - Update `@anthropic-ai/claude-agent-sdk` version in root `package.json` (use exact version, no caret)
  - Update `@modelcontextprotocol/sdk` version in `packages/electron/package.json` (use caret prefix)
6. **Run npm install** at the repository root to update package-lock.json
7. **Verify** the updates were successful by checking the installed versions

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

If either package is already at the latest version, note that no update is needed.
