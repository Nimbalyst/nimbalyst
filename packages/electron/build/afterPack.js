// afterPack.js - Post-packaging hook
// Strips existing signatures from Bun-compiled binaries before electron-builder signing

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  const { appOutDir, packager } = context;

  if (packager.platform.name !== 'mac') {
    console.log('AfterPack: Complete (non-macOS platform)');
    return;
  }

  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
  const claudeHelperBin = path.join(appPath, 'Contents/Resources/claude-helper-bin/claude-helper');

  // Strip existing signature from Bun-compiled binary before electron-builder signing
  // Bun binaries include an adhoc signature that causes "main executable failed strict validation"
  // when codesign tries to replace it with a proper Developer ID signature
  if (fs.existsSync(claudeHelperBin)) {
    console.log('AfterPack: Stripping existing signature from claude-helper binary...');
    try {
      execSync(`codesign --remove-signature "${claudeHelperBin}"`, { stdio: 'inherit' });
      console.log('AfterPack: Successfully stripped signature from claude-helper');
    } catch (error) {
      console.error('AfterPack: Failed to strip signature:', error.message);
      // Continue anyway - the binary might not have been signed
    }
  } else {
    console.log('AfterPack: claude-helper binary not found at:', claudeHelperBin);
  }

  console.log('AfterPack: Complete');
};
