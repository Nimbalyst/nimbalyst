import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  buildMcpRemoteArgs,
  checkMcpRemoteAuthStatus,
  extractMcpRemoteConfig,
} from '../MCPRemoteOAuth';

describe('MCPRemoteOAuth', () => {
  const originalConfigDir = process.env.MCP_REMOTE_CONFIG_DIR;

  afterEach(async () => {
    if (originalConfigDir === undefined) {
      delete process.env.MCP_REMOTE_CONFIG_DIR;
    } else {
      process.env.MCP_REMOTE_CONFIG_DIR = originalConfigDir;
    }
  });

  it('detects Slack-style remote HTTP configs with explicit OAuth metadata', () => {
    const descriptor = extractMcpRemoteConfig({
      type: 'http',
      url: 'https://mcp.slack.com/mcp',
      oauth: {
        callbackPort: 3118,
        staticClientInfo: {
          client_id: 'client-123',
        },
      },
    });

    expect(descriptor).toEqual(expect.objectContaining({
      serverUrl: 'https://mcp.slack.com/mcp',
      callbackPort: 3118,
      requiresOAuth: true,
      staticOAuthClientInfo: {
        client_id: 'client-123',
      },
    }));
  });

  it('does not route native remote OAuth configs through mcp-remote', () => {
    const descriptor = extractMcpRemoteConfig({
      type: 'http',
      url: 'https://mcp.slack.com/mcp',
      oauth: {
        callbackPort: 3118,
        clientId: 'client-123',
      },
    });

    expect(descriptor).toBeNull();
  });

  it('does not mark bearer-token HTTP servers as OAuth', () => {
    const descriptor = extractMcpRemoteConfig({
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: {
        Authorization: 'Bearer ${GITHUB_TOKEN}',
      },
    });

    expect(descriptor?.requiresOAuth).toBe(false);
  });

  it('builds mcp-remote args with static client info and callback port', () => {
    const descriptor = extractMcpRemoteConfig({
      type: 'http',
      url: 'https://mcp.slack.com/mcp',
      oauth: {
        callbackPort: 3118,
        staticClientInfo: {
          client_id: 'client-123',
        },
      },
    });

    expect(descriptor).toBeTruthy();
    expect(buildMcpRemoteArgs(descriptor!)).toEqual([
      'mcp-remote',
      'https://mcp.slack.com/mcp',
      '3118',
      '--static-oauth-client-info',
      JSON.stringify({ client_id: 'client-123' }),
    ]);
  });

  it('matches mcp-remote token hashes using URL, resource, and headers', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-remote-auth-'));
    process.env.MCP_REMOTE_CONFIG_DIR = tempDir;

    const versionDir = path.join(tempDir, 'mcp-remote-0.1.0');
    await fs.mkdir(versionDir, { recursive: true });

    const serverUrl = 'https://example.com/mcp';
    const resource = 'https://example.com/resource';
    const headers = { Authorization: 'Bearer custom-token' };
    const sortedKeys = Object.keys(headers).sort();
    const hash = crypto
      .createHash('md5')
      .update([serverUrl, resource, JSON.stringify(headers, sortedKeys)].join('|'))
      .digest('hex');

    await fs.writeFile(
      path.join(versionDir, `${hash}_tokens.json`),
      JSON.stringify({ access_token: 'token-value' }),
      'utf8',
    );

    const status = await checkMcpRemoteAuthStatus({
      type: 'http',
      url: serverUrl,
      headers,
      oauth: {
        resource,
      },
    });

    expect(status.authorized).toBe(true);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
