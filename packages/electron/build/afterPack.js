// afterPack.js - Post-packaging hook
// Prunes unused platform binaries to reduce app size

const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  const { appOutDir, packager } = context;

  const { Arch } = require('builder-util');
  const archNum = context.arch ?? packager.arch;
  const arch = archNum != null ? Arch[archNum] : process.arch;
  // Map electron-builder platform names to Node.js platform names
  const platformMap = { mac: 'darwin', windows: 'win32', linux: 'linux' };
  const platformName = platformMap[packager.platform.name] || packager.platform.name;

  // Find the resources dir - path varies by platform
  const resourcesDir = packager.platform.name === 'mac'
    ? path.join(appOutDir, `${packager.appInfo.productName}.app`, 'Contents/Resources')
    : path.join(appOutDir, 'resources');

  // Prune unused platform binaries from claude-agent-sdk vendor/ripgrep directory
  // The SDK vendors ripgrep binaries for all 6 platform/arch combos (~61MB total).
  // We only need the one matching the build target.
  const keepDir = `${arch}-${platformName}`;
  const vendorRipgrepDir = path.join(resourcesDir, 'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep');

  if (fs.existsSync(vendorRipgrepDir)) {
    const entries = fs.readdirSync(vendorRipgrepDir, { withFileTypes: true });
    let removedCount = 0;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== keepDir) {
        fs.rmSync(path.join(vendorRipgrepDir, entry.name), { recursive: true });
        removedCount++;
      }
    }
    console.log(`AfterPack: Pruned ${removedCount} unused ripgrep platform dirs (kept ${keepDir})`);
  }

  // Prune non-target-platform SDK native binary packages.
  // npm installs all optional deps; we only need the one for the build target.
  // Each platform binary is ~200-245MB, so removing the others saves significant space.
  const targetPlatformPackage = `claude-agent-sdk-${platformName}-${arch}`;
  const unpackedNodeModules = path.join(resourcesDir, 'app.asar.unpacked/node_modules/@anthropic-ai');

  if (fs.existsSync(unpackedNodeModules)) {
    const entries = fs.readdirSync(unpackedNodeModules, { withFileTypes: true });
    let removedCount = 0;
    let removedSize = 0;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('claude-agent-sdk-') && entry.name !== targetPlatformPackage) {
        const dirPath = path.join(unpackedNodeModules, entry.name);
        const dirSize = getDirSize(dirPath);
        fs.rmSync(dirPath, { recursive: true });
        removedCount++;
        removedSize += dirSize;
      }
    }
    if (removedCount > 0) {
      console.log(`AfterPack: Pruned ${removedCount} non-target SDK platform packages (kept ${targetPlatformPackage}, saved ${Math.round(removedSize / 1024 / 1024)}MB)`);
    }
  }

  // Also check the asar files list for platform packages
  const asarNodeModules = path.join(resourcesDir, 'app/node_modules/@anthropic-ai');
  if (fs.existsSync(asarNodeModules)) {
    const entries = fs.readdirSync(asarNodeModules, { withFileTypes: true });
    let removedCount = 0;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('claude-agent-sdk-') && entry.name !== targetPlatformPackage) {
        fs.rmSync(path.join(asarNodeModules, entry.name), { recursive: true });
        removedCount++;
      }
    }
    if (removedCount > 0) {
      console.log(`AfterPack: Pruned ${removedCount} non-target SDK platform packages from asar`);
    }
  }

  console.log('AfterPack: Complete');
};

function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch {}
  return size;
}
