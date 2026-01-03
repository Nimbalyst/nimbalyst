# MCP Server Template Verification Report

Generated: 2026-01-02

This document verifies each MCP server template in `packages/electron/src/renderer/components/GlobalSettings/panels/MCPServersPanel.tsx` against official documentation and npm/PyPI registries.

## Summary (After Fixes)

All 28 MCP server templates have been verified and corrected where necessary.

| Status | Count |
|--------|-------|
| Correct | 28 |
| Fixed | 15 |

## Verification Table

| Template | Package | Status | Confidence | Notes |
|----------|---------|--------|------------|-------|
| Linear | `mcp-remote` + `https://mcp.linear.app/mcp` | Correct | High | OAuth flow |
| GitHub | `@modelcontextprotocol/server-github` | Correct | High | Deprecated but functional |
| GitLab | `@modelcontextprotocol/server-gitlab` | Correct | High | |
| Slack | `@modelcontextprotocol/server-slack` | Correct | High | Deprecated but functional |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Fixed | High | Connection string now passed as CLI arg |
| Filesystem | `@modelcontextprotocol/server-filesystem` | Fixed | High | Directory path now required |
| Brave Search | `@brave/brave-search-mcp-server` | Fixed | High | Updated to official Brave package |
| Google Drive | `@modelcontextprotocol/server-gdrive` | Correct | Medium | Deprecated but functional |
| PostHog | `mcp-remote@latest` + SSE | Correct | High | |
| Atlassian | `mcp-remote` + `https://mcp.atlassian.com/v1/sse` | Correct | High | |
| Notion | `mcp-remote` + `https://mcp.notion.com/mcp` | Correct | High | |
| Asana | `mcp-remote` + `https://mcp.asana.com/sse` | Correct | High | |
| Playwright | `@playwright/mcp@latest` | Correct | High | |
| Context7 | `@upstash/context7-mcp@latest` | Correct | High | |
| n8n | `n8n-mcp` | Fixed | High | Changed from non-existent `@anthropic/mcp-server-n8n` |
| Zapier | `mcp-remote` + user URL | Fixed | Medium | Now requires user-specific MCP URL |
| AWS | `uvx awslabs.aws-api-mcp-server@latest` | Fixed | High | Changed to Python-based official package |
| Stripe | `@stripe/mcp` | Fixed | High | Corrected package name and env var |
| Snowflake | `uvx snowflake-labs-mcp` | Fixed | High | Changed to Python-based official package |
| Sequential Thinking | `@modelcontextprotocol/server-sequential-thinking` | Fixed | High | Added missing hyphen |
| Shopify Dev | `@shopify/dev-mcp@latest` | Fixed | High | Changed to official dev docs package |
| Fetch | `uvx mcp-server-fetch` | Fixed | High | Changed to Python-based package |
| Chrome DevTools | `chrome-devtools-mcp@latest` | Fixed | High | Changed to official Chrome DevTools package |
| Claude Flow | `claude-flow@alpha mcp start` | Fixed | High | Changed to correct community package |
| Blender | `uvx blender-mcp` | Fixed | High | Changed to Python-based package |
| Knowledge Graph Memory | `@modelcontextprotocol/server-memory` | Correct | High | |
| Task Master | `task-master-ai` | Fixed | High | Changed package name, added API key requirement |
| Serena | `uvx` + git install | Correct | High | |
| Desktop Commander | `@wonderwhy-er/desktop-commander` | Correct | High | |

## Fixes Applied

### 1. n8n
- **Before**: `@anthropic/mcp-server-n8n` (non-existent)
- **After**: `n8n-mcp`
- **Changes**: Updated package name, changed env var from `N8N_BASE_URL` to `N8N_API_URL`, added `MCP_MODE: 'stdio'`

### 2. Stripe
- **Before**: `@stripe/mcp-server`, `STRIPE_API_KEY`
- **After**: `@stripe/mcp`, `STRIPE_SECRET_KEY`
- **Changes**: Corrected package name, added `--tools=all` flag, fixed env var name

### 3. Sequential Thinking
- **Before**: `@modelcontextprotocol/server-sequentialthinking`
- **After**: `@modelcontextprotocol/server-sequential-thinking`
- **Changes**: Added missing hyphen in package name

### 4. Brave Search
- **Before**: `@modelcontextprotocol/server-brave-search` (deprecated)
- **After**: `@brave/brave-search-mcp-server`
- **Changes**: Updated to official Brave package, updated docsUrl

### 5. AWS
- **Before**: `npx @aws/aws-mcp-server` (non-existent)
- **After**: `uvx awslabs.aws-api-mcp-server@latest`
- **Changes**: Changed to Python-based official package, updated docsUrl

### 6. Snowflake
- **Before**: `npx @snowflake-labs/mcp-server-snowflake` (non-existent)
- **After**: `uvx snowflake-labs-mcp`
- **Changes**: Changed to Python-based official package, updated docsUrl

### 7. Shopify
- **Before**: `@shopify/mcp-server` (non-existent), required API key
- **After**: `@shopify/dev-mcp@latest`, no auth required
- **Changes**: Changed to official dev documentation package, updated name/description, removed auth requirement

### 8. Fetch
- **Before**: `npx @modelcontextprotocol/server-fetch` (non-existent)
- **After**: `uvx mcp-server-fetch`
- **Changes**: Changed to Python-based package

### 9. Chrome DevTools
- **Before**: `@anthropic/mcp-server-chrome-devtools` (non-existent)
- **After**: `chrome-devtools-mcp@latest`
- **Changes**: Changed to official Chrome DevTools team package, updated docsUrl

### 10. Claude Flow
- **Before**: `@anthropic/claude-flow-mcp` (non-existent)
- **After**: `claude-flow@alpha mcp start`
- **Changes**: Changed to community package by ruvnet, updated docsUrl

### 11. Blender
- **Before**: `npx blender-mcp` (npm package doesn't exist)
- **After**: `uvx blender-mcp`
- **Changes**: Changed to Python-based package, corrected docsUrl to ahujasid repo

### 12. Task Master
- **Before**: `task-master-mcp` (non-existent), no auth
- **After**: `task-master-ai`, requires Anthropic API key
- **Changes**: Corrected package name, updated docsUrl, added API key requirement

### 13. Zapier
- **Before**: `https://mcp.zapier.com/sse` (generic URL doesn't work)
- **After**: User-provided MCP URL via `ZAPIER_MCP_URL` env var
- **Changes**: Changed to require user-specific URL, changed authType to api-key

### 14. PostgreSQL
- **Before**: Connection string in env var (not supported by package)
- **After**: Connection string passed as CLI argument
- **Changes**: Moved connection string to args array, updated docsUrl to archived repo

### 15. Filesystem
- **Before**: No directory paths (required by package)
- **After**: Directory path required via env var
- **Changes**: Added required directory path argument, updated description

## Python-based Servers (require `uvx`)

The following servers are Python-based and require `uvx` (from the `uv` package manager) instead of `npx`:

1. **AWS** - `uvx awslabs.aws-api-mcp-server@latest`
2. **Snowflake** - `uvx snowflake-labs-mcp`
3. **Fetch** - `uvx mcp-server-fetch`
4. **Blender** - `uvx blender-mcp`
5. **Serena** - `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`

Users will need Python 3.10+ and the `uv` package manager installed to use these servers.

## Deprecated but Functional

These packages still work but are no longer actively maintained:

1. **GitHub** (`@modelcontextprotocol/server-github`) - Official replacement is `github/github-mcp-server`
2. **Slack** (`@modelcontextprotocol/server-slack`) - Moved to archived repo
3. **Google Drive** (`@modelcontextprotocol/server-gdrive`) - Moved to archived repo
4. **PostgreSQL** (`@modelcontextprotocol/server-postgres`) - Moved to archived repo
