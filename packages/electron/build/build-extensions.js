/**
 * Build all extensions before packaging.
 *
 * This script finds all extensions in packages/extensions/ that have a build script
 * and runs npm run build for each one. This ensures extension dist/ folders exist
 * before electron-builder packages them.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXTENSIONS_DIR = path.resolve(__dirname, '..', '..', 'extensions');

async function buildExtensions() {
  console.log('Building extensions...');

  // Check if extensions directory exists
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    console.log('No extensions directory found, skipping');
    return;
  }

  // Get all subdirectories in the extensions folder
  const entries = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true });
  const extensionDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const extDir of extensionDirs) {
    const extPath = path.join(EXTENSIONS_DIR, extDir);
    const packageJsonPath = path.join(extPath, 'package.json');

    // Check if package.json exists
    if (!fs.existsSync(packageJsonPath)) {
      console.log(`  Skipping ${extDir}: no package.json`);
      continue;
    }

    // Read package.json to check for build script
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    if (!packageJson.scripts?.build) {
      console.log(`  Skipping ${extDir}: no build script`);
      continue;
    }

    console.log(`  Building ${extDir}...`);

    try {
      execSync('npm run build', {
        cwd: extPath,
        stdio: 'inherit',
      });
      console.log(`  Built ${extDir} successfully`);
    } catch (error) {
      console.error(`  Failed to build ${extDir}:`, error.message);
      process.exit(1);
    }
  }

  console.log('All extensions built successfully');
}

buildExtensions().catch((error) => {
  console.error('Failed to build extensions:', error);
  process.exit(1);
});
