# MCP Server Template Verification Report

Generated: 2026-01-07

This document verifies each MCP server template in `packages/electron/src/renderer/components/GlobalSettings/panels/MCPServersPanel.tsx` against official documentation and npm/PyPI registries.

## Summary

All 22 MCP server templates are now verified as official first-party implementations.

| Status | Count |
|--------|-------|
| Official (Active) | 22 |
| Removed (Unofficial) | 5 |
| Removed (Deprecated/Security) | 1 |

## Current Templates (All Official)

| Template | Package/URL | Auth | Source |
|----------|-------------|------|--------|
| Linear | `mcp-remote` + `mcp.linear.app` | OAuth | Linear (vendor) |
| GitHub | `mcp-remote` + `api.githubcopilot.com/mcp/` | OAuth | GitHub (vendor) |
| GitLab | `mcp-remote` + `gitlab.com/api/v4/mcp` | OAuth | GitLab (vendor) |
| Slack | `mcp-remote` + `api.slack.com/mcp/sse` | OAuth | Slack (vendor) |
| Filesystem | `@modelcontextprotocol/server-filesystem` | None | MCP (Anthropic) |
| Brave Search | `@brave/brave-search-mcp-server` | API Key | Brave (vendor) |
| PostHog | `mcp-remote` + `mcp.posthog.com/sse` | API Key | PostHog (vendor) |
| Atlassian | `mcp-remote` + `mcp.atlassian.com/v1/sse` | OAuth | Atlassian (vendor) |
| Notion | `mcp-remote` + `mcp.notion.com/mcp` | OAuth | Notion (vendor) |
| Asana | `mcp-remote` + `mcp.asana.com/sse` | OAuth | Asana (vendor) |
| Playwright | `@playwright/mcp@latest` | None | Microsoft (vendor) |
| Context7 | `@upstash/context7-mcp@latest` | None | Upstash (vendor) |
| Zapier | `mcp-remote` + user URL | API Key | Zapier (vendor) |
| AWS | `uvx awslabs.aws-api-mcp-server@latest` | API Key | AWS Labs (vendor) |
| Stripe | `@stripe/mcp` | API Key | Stripe (vendor) |
| Snowflake | `uvx snowflake-labs-mcp` | API Key | Snowflake Labs (vendor) |
| Sequential Thinking | `@modelcontextprotocol/server-sequential-thinking` | None | MCP (Anthropic) |
| Shopify Dev | `@shopify/dev-mcp@latest` | None | Shopify (vendor) |
| Fetch | `uvx mcp-server-fetch` | None | MCP (Anthropic) |
| Chrome DevTools | `chrome-devtools-mcp@latest` | None | Google Chrome DevTools (vendor) |
| Knowledge Graph Memory | `@modelcontextprotocol/server-memory` | None | MCP (Anthropic) |
| Serena | `uvx` + git install from oraios/serena | None | Oraios AI (vendor) |

## Removed Templates

### Removed - Unofficial/Community (5 servers)

These were community contributions, not official first-party implementations:

| Template | Previous Package | Reason |
|----------|------------------|--------|
| n8n | `n8n-mcp` | Community (czlonkowski), not from n8n GmbH |
| Claude Flow | `claude-flow` | Community (ruvnet), not from Anthropic |
| Blender | `blender-mcp` | Community (ahujasid), not from Blender Foundation |
| Task Master | `task-master-ai` | Community (eyaltoledano), not from Anthropic |
| Desktop Commander | `@wonderwhy-er/desktop-commander` | Community, explicitly states not an Anthropic product |

### Removed - Deprecated/Security Issues (1 server)

| Template | Previous Package | Reason |
|----------|------------------|--------|
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Archived July 2025, SQL injection vulnerability |

## Updated Templates

### GitHub
- **Before**: `@modelcontextprotocol/server-github` (deprecated)
- **After**: Remote server via `mcp-remote` + `https://api.githubcopilot.com/mcp/`
- **Auth**: Changed from API key to OAuth
- **Source**: [GitHub MCP Server](https://github.com/github/github-mcp-server)

### GitLab
- **Before**: `@modelcontextprotocol/server-gitlab` (archived May 2025)
- **After**: Remote server via `mcp-remote` + `https://gitlab.com/api/v4/mcp`
- **Auth**: Changed from API key to OAuth
- **Source**: [GitLab MCP Documentation](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/)

### Slack
- **Before**: `@modelcontextprotocol/server-slack` (deprecated/archived)
- **After**: Remote server via `mcp-remote` + `https://api.slack.com/mcp/sse`
- **Auth**: Changed from API key (bot token) to OAuth
- **Source**: [Slack MCP Documentation](https://docs.slack.dev/ai/mcp-server/)

## Python-based Servers (require `uvx`)

The following servers are Python-based and require `uvx` (from the `uv` package manager):

1. **AWS** - `uvx awslabs.aws-api-mcp-server@latest`
2. **Snowflake** - `uvx snowflake-labs-mcp`
3. **Fetch** - `uvx mcp-server-fetch`
4. **Serena** - `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`

Users need Python 3.10+ and the `uv` package manager installed for these servers.

## Verification Sources

- [Model Context Protocol Servers](https://github.com/modelcontextprotocol/servers)
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
- [GitLab MCP Documentation](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/)
- [Slack MCP Documentation](https://docs.slack.dev/ai/mcp-server/)
- [AWS MCP Servers](https://github.com/awslabs/mcp)
- [Snowflake MCP](https://github.com/Snowflake-Labs/mcp)
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
