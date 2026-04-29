#!/usr/bin/env node

/**
 * Validates the OUTPUT of a packaged build by exercising the real Node ESM
 * resolver (dynamic `import()`) against the packaged
 * app.asar.unpacked/node_modules tree. This is the same code path the
 * runtime uses, so it catches the failure class where build is green but
 * the feature is broken because runtime resolution would fail.
 *
 * Why this exists: validate-extra-resources.js only checks INPUTS (do the
 * source paths exist before electron-builder runs). That answers "did the
 * config look right" but NOT "did the packaging actually work". Every
 * recurring "build green, feature broken in production" bug we've shipped
 * has been a packaging-output failure that input validation cannot catch.
 *
 * What this checks against the packaged app:
 * 1. Each SDK that is loaded via dynamic `import()` at runtime resolves
 *    correctly from app.asar.unpacked/node_modules. Uses ESM semantics --
 *    honors package.json `exports` maps with `import` conditions, which is
 *    what runtime `await import('@opencode-ai/sdk/client')` does.
 * 2. Each native binary that the runtime spawns exists at the path the
 *    runtime expects AND is executable.
 *
 * Run: node validate-packaged-sdks.js <path-to-packaged-app> [--platform <p>] [--arch <a>]
 *   - macOS:   /path/to/Nimbalyst.app
 *   - Linux:   /path/to/Nimbalyst-Linux.AppImage (extracted dir)
 *   - Windows: /path/to/install/dir
 *
 * Pass --platform/--arch when the caller knows the build target (afterPack
 * does); otherwise the validator infers from the appPath, falling back to
 * the host platform/arch. The fallback is unsafe for cross-arch builds where
 * electron-builder uses an unsuffixed output dir (e.g. release/mac/ for the
 * default-arch mac build) -- the validator then checks the host arch's
 * binary, which afterPack has already pruned for being non-target.
 *
 * Wired into:
 *   - packages/electron/build/afterPack.js (passes --platform/--arch)
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = at least one SDK or binary missing/unresolvable in the packaged app
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = { positional: [], platform: undefined, arch: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' && i + 1 < argv.length) { out.platform = argv[++i]; continue; }
    if (a === '--arch' && i + 1 < argv.length) { out.arch = argv[++i]; continue; }
    out.positional.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const appPath = args.positional[0];
if (!appPath) {
  console.error('usage: validate-packaged-sdks.js <path-to-packaged-app> [--platform <p>] [--arch <a>]');
  process.exit(1);
}

if (!fs.existsSync(appPath)) {
  console.error(`Path does not exist: ${appPath}`);
  process.exit(1);
}

// Locate app.asar.unpacked across macOS/Win/Linux layouts.
function findUnpackedRoot(rootPath) {
  const candidates = [
    path.join(rootPath, 'Contents', 'Resources', 'app.asar.unpacked'),
    path.join(rootPath, 'resources', 'app.asar.unpacked'),
    path.join(rootPath, 'app.asar.unpacked'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const unpackedRoot = findUnpackedRoot(appPath);
if (!unpackedRoot) {
  console.error(`Could not find app.asar.unpacked under: ${appPath}`);
  process.exit(1);
}
const nodeModulesPath = path.join(unpackedRoot, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.error(`No node_modules dir at: ${nodeModulesPath}`);
  process.exit(1);
}

console.log(`[validate-packaged-sdks] node_modules: ${nodeModulesPath}`);

// Prefer explicit --platform/--arch from the caller (afterPack passes them
// from electron-builder's authoritative context). Fall back to detection
// from the appPath only for direct CLI use, and refuse to use the host
// values silently -- a cross-arch build whose output dir lacks an arch
// token (e.g. release/mac/ for default-arch mac) would otherwise check
// the wrong arch and report an already-pruned package as missing.
function detectArchFromPath(p) {
  if (/[-_/]arm64/.test(p)) return 'arm64';
  if (/[-_/](x64|x86_64)/.test(p)) return 'x64';
  return null;
}
function detectPlatformFromPath(p) {
  if (/Contents[/\\]MacOS/.test(p) || p.endsWith('.app') || /[-_/]mac/.test(p)) return 'darwin';
  if (/[-_/]win/.test(p) || p.endsWith('.exe')) return 'win32';
  if (/[-_/]linux/.test(p)) return 'linux';
  return null;
}
const targetArch = args.arch || detectArchFromPath(appPath);
const targetPlatform = args.platform || detectPlatformFromPath(appPath);
if (!targetArch || !targetPlatform) {
  console.error(
    `[validate-packaged-sdks] cannot determine target platform/arch from "${appPath}". ` +
    `Pass --platform <darwin|win32|linux> --arch <x64|arm64> explicitly. ` +
    `(Refusing to fall back to the host -- that produces false negatives on cross-arch builds.)`,
  );
  process.exit(1);
}
console.log(`[validate-packaged-sdks] target: ${targetPlatform}-${targetArch}`);

// Mirror of getCodexTargetTriple in codexBinaryPath.ts.
function codexTargetTriple(plat, arch) {
  if (plat === 'darwin') {
    if (arch === 'x64') return 'x86_64-apple-darwin';
    if (arch === 'arm64') return 'aarch64-apple-darwin';
  }
  if (plat === 'linux') {
    if (arch === 'x64') return 'x86_64-unknown-linux-musl';
    if (arch === 'arm64') return 'aarch64-unknown-linux-musl';
  }
  if (plat === 'win32') {
    if (arch === 'x64') return 'x86_64-pc-windows-msvc';
    if (arch === 'arm64') return 'aarch64-pc-windows-msvc';
  }
  return undefined;
}

// SDK packages dynamically imported at runtime via ESM `import()`.
// KEEP IN SYNC with the `external` arrays in packages/electron/electron.vite.config.ts
// (main process) and packages/runtime/vite.config.ts.
//
// NOTE: @zed-industries/codex-acp is NOT in this list because the runtime
// never imports it as a JS module -- it's a CLI-only package (no `main` /
// `exports`), and the runtime uses `require.resolve(<pkg>/package.json)`
// just to discover the install dir before spawning the bin. Treat that as
// a "package presence" check, not an import check.
const SDK_IMPORTS = [
  '@anthropic-ai/claude-agent-sdk',
  '@openai/codex-sdk',
  '@opencode-ai/sdk',
  '@opencode-ai/sdk/client',
];

// Packages whose runtime usage is only `require.resolve(<pkg>/package.json)`
// to find where their platform-specific bin sibling is installed. Verify
// the package.json exists in the unpacked tree.
const PACKAGE_PRESENCE = [
  '@zed-industries/codex-acp',
];

// Run the ESM import harness from an ISOLATED temp dir whose only
// node_modules is a symlink to the packaged tree.
//
// CRITICAL: do NOT run the harness from inside the .app bundle. Node's
// module resolver walks UP the filesystem looking for node_modules, so a
// harness inside `<repo>/packages/electron/release/.../app.asar.unpacked/`
// would happily find packages from `<repo>/node_modules/` and report
// "ok" even if the packaged app is missing them entirely. That false
// pass is exactly the failure class this validator must catch.
//
// Putting the harness under /tmp ensures the only resolvable
// node_modules is the symlink we control -- if the packaged tree is
// missing a package, the import fails for real.
function runEsmImportChecks(specs) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-packaged-sdks-'));
  const tmpNodeModules = path.join(tmpRoot, 'node_modules');
  const harnessPath = path.join(tmpRoot, '_validate.mjs');

  // Windows can't create 'dir' symlinks without admin/Developer Mode, but
  // 'junction' works without elevation and is what npm/yarn use internally.
  // 'junction' is a no-op alias for 'dir' on POSIX, so we use it everywhere.
  fs.symlinkSync(path.resolve(nodeModulesPath), tmpNodeModules, 'junction');

  // Build the prefix using pathToFileURL so it matches the form produced by
  // import.meta.resolve. Hand-concatenating "file://" + an OS path breaks on
  // Windows because (a) file URLs need three slashes for a drive letter
  // ("file:///D:/...") and (b) Windows OS paths use backslashes, but file
  // URLs always use forward slashes -- so a startsWith check on the wrong
  // form falsely reports every resolved import as "outside the tree".
  const expectedPrefix = pathToFileURL(path.resolve(nodeModulesPath)).href;
  const source = `
import { createRequire } from 'node:module';
const specs = ${JSON.stringify(specs)};
const expectedPrefix = ${JSON.stringify(expectedPrefix)};
const results = [];
for (const spec of specs) {
  let resolvedUrl;
  try {
    // Resolve first to capture the URL, then load.
    resolvedUrl = import.meta.resolve(spec);
    if (!resolvedUrl.startsWith(expectedPrefix)) {
      results.push({
        spec, ok: false, resolved: resolvedUrl,
        message: 'resolved OUTSIDE packaged tree (Node walked up the filesystem) -- in production this would fail',
      });
      continue;
    }
    await import(spec);
    results.push({ spec, ok: true, resolved: resolvedUrl });
  } catch (err) {
    results.push({
      spec, ok: false, resolved: resolvedUrl,
      code: err && err.code,
      message: err && err.message ? String(err.message).split('\\n')[0] : String(err),
    });
  }
}
process.stdout.write(JSON.stringify(results));
`;
  fs.writeFileSync(harnessPath, source, 'utf8');

  try {
    const result = spawnSync(process.execPath, [harnessPath], {
      cwd: tmpRoot,
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (!result.stdout) {
      throw new Error(`harness produced no output (exit ${result.status}): ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

// Native binaries the runtime spawns. Paths mirror runtime resolution
// logic (codexBinaryPath.ts, CodexACPProtocol.resolveCodexAcpBinary, etc).
function nativeBinaryChecks() {
  const out = [];
  const nmRel = (...parts) => path.join(nodeModulesPath, ...parts);

  // 1. claude binary -- @anthropic-ai/claude-agent-sdk-<plat>-<arch>/claude(.exe)
  const claudePlatDir = `claude-agent-sdk-${targetPlatform === 'win32' ? 'win32' : targetPlatform}-${targetArch}`;
  out.push({
    label: 'claude binary (@anthropic-ai/claude-agent-sdk)',
    candidates: [
      nmRel('@anthropic-ai', claudePlatDir, targetPlatform === 'win32' ? 'claude.exe' : 'claude'),
    ],
  });

  // 2. codex binary -- @openai/codex-<plat>-<arch>/vendor/<triple>/codex/codex(.exe)
  // The actual binary lives one level deeper inside a `codex` subdirectory.
  const triple = codexTargetTriple(targetPlatform, targetArch);
  if (triple) {
    const codexPlatDir = `codex-${targetPlatform === 'win32' ? 'win32' : targetPlatform}-${targetArch}`;
    const codexBin = targetPlatform === 'win32' ? 'codex.exe' : 'codex';
    out.push({
      label: 'codex binary (@openai/codex)',
      candidates: [
        nmRel('@openai', codexPlatDir, 'vendor', triple, 'codex', codexBin),
        nmRel('@openai', codexPlatDir, 'vendor', triple, codexBin),
      ],
    });
  }

  // 3. codex-acp binary -- @zed-industries/codex-acp-<plat>-<arch>/bin/codex-acp(.exe)
  const acpPlatDir = `codex-acp-${targetPlatform === 'win32' ? 'win32' : targetPlatform}-${targetArch}`;
  out.push({
    label: 'codex-acp binary (@zed-industries/codex-acp)',
    candidates: [
      nmRel('@zed-industries', acpPlatDir, 'bin', targetPlatform === 'win32' ? 'codex-acp.exe' : 'codex-acp'),
    ],
  });

  return out;
}

function isExecutableFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return /\.(exe|cmd|bat)$/i.test(filePath);
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

const failures = [];

// ---- 1. SDK ESM imports ----
console.log('\n[validate-packaged-sdks] Resolving SDK imports via real ESM...');
const importResults = runEsmImportChecks(SDK_IMPORTS);
for (const r of importResults) {
  if (r.ok) {
    console.log(`  [ok] import("${r.spec}")`);
  } else {
    failures.push({
      kind: 'sdk',
      target: r.spec,
      reason: `ESM import() failed: ${r.code ? r.code + ' -- ' : ''}${r.message}`,
    });
  }
}

// ---- 1b. Package presence (for CLI-only packages used via path resolution) ----
console.log('\n[validate-packaged-sdks] Checking package presence...');
for (const pkg of PACKAGE_PRESENCE) {
  const pkgJsonPath = path.join(nodeModulesPath, pkg, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    console.log(`  [ok] ${pkg}/package.json present`);
  } else {
    failures.push({
      kind: 'package',
      target: pkg,
      reason: `package.json not present at ${path.relative(nodeModulesPath, pkgJsonPath)}`,
    });
  }
}

// ---- 2. Native binary existence + executability ----
console.log('\n[validate-packaged-sdks] Checking native binaries...');
for (const check of nativeBinaryChecks()) {
  const found = check.candidates.find(isExecutableFile);
  if (found) {
    console.log(`  [ok] ${check.label} -> ${path.relative(nodeModulesPath, found)}`);
    continue;
  }
  // Distinguish "exists but not executable" from "missing entirely" for a clear error.
  const existing = check.candidates.find(fs.existsSync);
  failures.push({
    kind: 'binary',
    target: check.label,
    reason: existing
      ? `${path.relative(nodeModulesPath, existing)} exists but is not an executable file (likely a directory or missing exec bits)`
      : `not found at: ${check.candidates.map((c) => path.relative(nodeModulesPath, c)).join(' OR ')}`,
  });
}

// ---- Report ----
if (failures.length === 0) {
  console.log(
    `\n[validate-packaged-sdks] PASS: ${SDK_IMPORTS.length} SDK imports + ${nativeBinaryChecks().length} native binaries verified in packaged tree.`,
  );
  process.exit(0);
}

console.error('\n[validate-packaged-sdks] FAIL: the packaged app is missing runtime-required files.\n');
console.error('This is the failure class that input-only validation cannot catch:');
console.error('builds appear green and ship, then break at runtime when the');
console.error('feature actually tries to load its dependency.\n');
for (const f of failures) {
  console.error(`  [${f.kind}] ${f.target}`);
  console.error(`         ${f.reason}\n`);
}
console.error(`Inspect: ${nodeModulesPath}`);
process.exit(1);
