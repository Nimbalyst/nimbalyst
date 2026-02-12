import fs from 'fs';
import path from 'path';

type SupportedPlatform = NodeJS.Platform;

export function getCodexTargetTriple(platform: SupportedPlatform, arch: string): string | undefined {
  if (platform === 'linux' || platform === 'android') {
    if (arch === 'x64') return 'x86_64-unknown-linux-musl';
    if (arch === 'arm64') return 'aarch64-unknown-linux-musl';
    return undefined;
  }

  if (platform === 'darwin') {
    if (arch === 'x64') return 'x86_64-apple-darwin';
    if (arch === 'arm64') return 'aarch64-apple-darwin';
    return undefined;
  }

  if (platform === 'win32') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc';
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc';
    return undefined;
  }

  return undefined;
}

/**
 * Options for resolving the Codex binary path in packaged applications.
 */
export interface CodexBinaryPathResolutionOptions {
  /** Path to the Electron app's resources directory. Defaults to process.resourcesPath. */
  resourcesPath?: string;
  /** Operating system platform. Defaults to process.platform. */
  platform?: SupportedPlatform;
  /** CPU architecture. Defaults to process.arch. */
  arch?: string;
  /** File system existence check function. Defaults to fs.existsSync. */
  existsSync?: (candidatePath: string) => boolean;
}

/**
 * Resolve a packaged-app-safe Codex binary path.
 * In Electron packaged apps, SDK module resolution may point inside app.asar,
 * but child_process.spawn cannot execute binaries from asar virtual paths.
 */
export function resolvePackagedCodexBinaryPath(
  options: CodexBinaryPathResolutionOptions = {}
): string | undefined {
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (!resourcesPath) {
    return undefined;
  }

  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const existsSync = options.existsSync ?? fs.existsSync;

  const targetTriple = getCodexTargetTriple(platform, arch);
  if (!targetTriple) {
    return undefined;
  }

  const binaryName = platform === 'win32' ? 'codex.exe' : 'codex';
  const relativeBinaryPath = path.join(
    '@openai',
    'codex-sdk',
    'vendor',
    targetTriple,
    'codex',
    binaryName
  );

  const candidates = [
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', relativeBinaryPath),
    path.join(resourcesPath, 'node_modules', relativeBinaryPath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
