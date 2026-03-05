import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export async function resolveClaudeAgentCliPath(): Promise<string> {
  try {
    const claudeAgentPath = require.resolve('@anthropic-ai/claude-agent-sdk');
    const claudeAgentDir = path.dirname(claudeAgentPath);
    let cliPath = path.join(claudeAgentDir, 'cli.js');

    // In packaged apps, system Node.js cannot read from app.asar directly.
    if (app.isPackaged && cliPath.includes('app.asar')) {
      const unpackedCliPath = cliPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked');

      if (!fs.existsSync(unpackedCliPath)) {
        const error = `Unpacked CLI not found at: ${unpackedCliPath}. ` +
                     `This indicates a build configuration issue. The Claude Agent SDK must be unpacked during the build process.`;
        console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
        throw new Error(error);
      }

      const appPath = app.getAppPath();
      const unpackedAppPath = appPath.includes('app.asar')
        ? appPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked')
        : appPath;
      const unpackedNodeModules = path.join(unpackedAppPath, 'node_modules');

      if (!fs.existsSync(unpackedNodeModules)) {
        const error = `Unpacked node_modules not found at: ${unpackedNodeModules}. ` +
                     `Build configuration must unpack node_modules for Claude Agent SDK.`;
        console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
        throw new Error(error);
      }

      const unpackedSdkDir = path.join(unpackedNodeModules, '@anthropic-ai', 'claude-agent-sdk');
      if (!fs.existsSync(unpackedSdkDir)) {
        const error = `SDK directory not found at: ${unpackedSdkDir}. ` +
                     `Build must unpack @anthropic-ai/claude-agent-sdk package.`;
        console.error(`[CLAUDE-CODE] ✗ CRITICAL ERROR: ${error}`);
        throw new Error(error);
      }

      cliPath = unpackedCliPath;
    }

    if (!fs.existsSync(cliPath)) {
      throw new Error(`CLI not found at expected path: ${cliPath}`);
    }

    return cliPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not find claude-agent-sdk CLI: ${message}`);
  }
}
