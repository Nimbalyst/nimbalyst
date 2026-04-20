#!/usr/bin/env node

/**
 * Validates that all extraResources 'from' paths in the electron-builder
 * config actually exist before building. electron-builder silently skips
 * missing sources, which produces broken builds with no error.
 */

const fs = require('fs');
const path = require('path');

const packageDir = path.join(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
);

const extraResources = packageJson.build?.extraResources;
if (!extraResources || !Array.isArray(extraResources)) {
  console.log('[validate-extra-resources] No extraResources config found, skipping.');
  process.exit(0);
}

const missing = [];

for (const entry of extraResources) {
  const from = typeof entry === 'string' ? entry : entry.from;
  if (!from) continue;

  const resolved = path.resolve(packageDir, from);
  if (!fs.existsSync(resolved)) {
    missing.push({ from, resolved });
  }
}

if (missing.length > 0) {
  console.error('\n[validate-extra-resources] ERROR: Missing extraResources sources!');
  console.error('electron-builder silently skips these, producing a broken build.\n');
  for (const { from, resolved } of missing) {
    console.error(`  from: "${from}"`);
    console.error(`  resolved: ${resolved}\n`);
  }
  console.error(
    'Common cause: npm workspace hoisting changed after a dependency upgrade.\n' +
    'Check whether the package moved between root node_modules/ and packages/electron/node_modules/.\n'
  );
  process.exit(1);
}

console.log(`[validate-extra-resources] All ${extraResources.length} extraResources sources exist.`);
