import path from 'path';
import { describe, expect, it } from 'vitest';
import { getCodexTargetTriple, resolvePackagedCodexBinaryPath } from '../codexBinaryPath';

describe('codexBinaryPath', () => {
  it('maps supported platform/arch combinations to codex target triples', () => {
    expect(getCodexTargetTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(getCodexTargetTriple('darwin', 'x64')).toBe('x86_64-apple-darwin');
    expect(getCodexTargetTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-musl');
    expect(getCodexTargetTriple('linux', 'x64')).toBe('x86_64-unknown-linux-musl');
    expect(getCodexTargetTriple('win32', 'arm64')).toBe('aarch64-pc-windows-msvc');
    expect(getCodexTargetTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
  });

  it('returns undefined for unsupported platform/arch combinations', () => {
    expect(getCodexTargetTriple('freebsd' as NodeJS.Platform, 'x64')).toBeUndefined();
    expect(getCodexTargetTriple('darwin', 'ia32')).toBeUndefined();
  });

  it('prefers app.asar.unpacked binary path when present', () => {
    const resourcesPath = '/Applications/Nimbalyst.app/Contents/Resources';
    const unpackedBinary = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-sdk',
      'vendor',
      'aarch64-apple-darwin',
      'codex',
      'codex'
    );

    const resolved = resolvePackagedCodexBinaryPath({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      existsSync: (candidate) => candidate === unpackedBinary,
    });

    expect(resolved).toBe(unpackedBinary);
  });

  it('falls back to resources/node_modules when unpacked path is unavailable', () => {
    const resourcesPath = '/Applications/Nimbalyst.app/Contents/Resources';
    const fallbackBinary = path.join(
      resourcesPath,
      'node_modules',
      '@openai',
      'codex-sdk',
      'vendor',
      'x86_64-apple-darwin',
      'codex',
      'codex'
    );

    const resolved = resolvePackagedCodexBinaryPath({
      resourcesPath,
      platform: 'darwin',
      arch: 'x64',
      existsSync: (candidate) => candidate === fallbackBinary,
    });

    expect(resolved).toBe(fallbackBinary);
  });

  it('normalizes resourcesPath when it points to app.asar', () => {
    const resourcesPath = '/Applications/Nimbalyst.app/Contents/Resources/app.asar';
    const normalizedBinary = path.join(
      '/Applications/Nimbalyst.app/Contents/Resources',
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-sdk',
      'vendor',
      'aarch64-apple-darwin',
      'codex',
      'codex'
    );

    const resolved = resolvePackagedCodexBinaryPath({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      existsSync: (candidate) => candidate === normalizedBinary,
    });

    expect(resolved).toBe(normalizedBinary);
  });

  it('supports flattened vendor binary layout', () => {
    const resourcesPath = '/Applications/Nimbalyst.app/Contents/Resources';
    const flattenedBinary = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-sdk',
      'vendor',
      'aarch64-apple-darwin',
      'codex'
    );

    const resolved = resolvePackagedCodexBinaryPath({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      existsSync: (candidate) => candidate === flattenedBinary,
    });

    expect(resolved).toBe(flattenedBinary);
  });
});
