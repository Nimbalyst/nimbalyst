import { resolveNativeBinaryPath } from '../../../../electron/claudeCodeEnvironment';

/**
 * Resolve the path to the Claude Agent SDK's native binary.
 *
 * SDK 0.2.114+ ships native binaries as per-platform optional dependencies.
 * The SDK resolves these automatically when no pathToClaudeCodeExecutable is set,
 * but in packaged Electron builds require.resolve may not find them inside asar.
 * This function provides a fallback path for packaged builds.
 */
export async function resolveClaudeAgentCliPath(): Promise<string> {
  const binaryPath = resolveNativeBinaryPath();
  if (binaryPath) {
    return binaryPath;
  }
  throw new Error('Could not find Claude Agent SDK native binary for this platform');
}
