#!/usr/bin/env node

/**
 * Normalizes extraResources sources before electron-builder packs.
 *
 * npm's hoisting behavior across workspaces is not always stable: the
 * same lockfile can place a dependency in packages/electron/node_modules/
 * on one machine and in the repo-root node_modules/ on another. The
 * electron-builder `extraResources` entries use literal paths, so if a
 * package lands at the other location, packaging silently ships a broken
 * build (or validate-extra-resources refuses to continue).
 *
 * For any extraResources entry whose `from` path starts with
 * `node_modules/` and is missing from packages/electron/node_modules/,
 * this script checks the repo-root node_modules/ and creates a symlink
 * at the expected location pointing back to wherever npm actually put
 * the package. Runs as a no-op when every path already exists.
 */

const fs = require('fs');
const path = require('path');

const packageDir = path.join(__dirname, '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
);

const extraResources = packageJson.build?.extraResources;
if (!Array.isArray(extraResources)) {
  process.exit(0);
}

let linked = 0;

// Sort entries shallowest path first so a broader symlink (e.g. the
// @openai scope dir) is created before any nested entries inside it
// (e.g. @openai/codex-sdk). Nested entries then satisfy via the parent
// symlink and are skipped.
const sortedEntries = extraResources
  .map((entry) => (typeof entry === 'string' ? entry : entry?.from))
  .filter((from) => typeof from === 'string' && from.startsWith('node_modules/'))
  .sort((a, b) => a.split('/').length - b.split('/').length);

for (const from of sortedEntries) {
  const expected = path.resolve(packageDir, from);
  if (fs.existsSync(expected)) continue;

  const rootPath = path.resolve(repoRoot, from);
  if (!fs.existsSync(rootPath)) continue;

  const parent = path.dirname(expected);
  fs.mkdirSync(parent, { recursive: true });
  const target = path.relative(parent, rootPath);
  fs.symlinkSync(target, expected);
  linked++;
  console.log(`[normalize-extra-resources] Linked ${from} -> ${target}`);
}

if (linked === 0) {
  console.log('[normalize-extra-resources] Nothing to normalize.');
} else {
  console.log(`[normalize-extra-resources] Linked ${linked} package(s) into packages/electron/node_modules/.`);
}
