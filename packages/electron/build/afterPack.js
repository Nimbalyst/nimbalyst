// afterPack.js - Post-packaging hook
// Strips existing signatures from Bun-compiled binaries before electron-builder signing

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Check if a binary has a code signature
 */
function hasSignature(binaryPath) {
  try {
    const result = execSync(`codesign -d "${binaryPath}" 2>&1`, { encoding: 'utf8' });
    return result.includes('Signature=');
  } catch {
    // codesign -d exits with error if no signature
    return false;
  }
}

/**
 * Strip code signature from a Mach-O binary.
 * Tries multiple methods since Bun adhoc signatures can cause "internal error".
 */
function stripSignature(binaryPath) {
  // Method 1: Standard codesign --remove-signature
  try {
    execSync(`codesign --remove-signature "${binaryPath}" 2>&1`, { encoding: 'utf8' });
    console.log('AfterPack: Stripped signature using codesign --remove-signature');
    return true;
  } catch (error) {
    console.log('AfterPack: codesign --remove-signature failed:', error.message.split('\n')[0]);
  }

  // Method 2: Use strip to remove __LINKEDIT code signature section
  // This is more aggressive but works when codesign fails
  try {
    // Check if the binary has a signature we need to remove
    const codesignCheck = execSync(`codesign -vvv "${binaryPath}" 2>&1`, { encoding: 'utf8' });
    if (codesignCheck.includes('adhoc')) {
      console.log('AfterPack: Binary has adhoc signature, attempting alternative removal...');
    }
  } catch {
    // Expected to fail if signature is invalid
  }

  // Method 3: Re-sign with adhoc to normalize the signature, then remove
  // This can fix corrupted signatures
  try {
    execSync(`codesign --force --sign - "${binaryPath}" 2>&1`, { encoding: 'utf8' });
    execSync(`codesign --remove-signature "${binaryPath}" 2>&1`, { encoding: 'utf8' });
    console.log('AfterPack: Stripped signature using adhoc re-sign then remove');
    return true;
  } catch (error) {
    console.log('AfterPack: Adhoc re-sign approach failed:', error.message.split('\n')[0]);
  }

  return false;
}

exports.default = async function(context) {
  const { appOutDir, packager } = context;

  if (packager.platform.name !== 'mac') {
    console.log('AfterPack: Complete (non-macOS platform)');
    return;
  }

  const appPath = path.join(appOutDir, `${packager.appInfo.productName}.app`);
  const claudeHelperBin = path.join(appPath, 'Contents/Resources/claude-helper-bin/claude-helper');

  // Strip existing signature from Bun-compiled binary before electron-builder signing
  // Bun binaries include an adhoc signature that can cause issues when codesign
  // tries to replace it with a proper Developer ID signature
  if (fs.existsSync(claudeHelperBin)) {
    console.log('AfterPack: Processing claude-helper binary...');

    // Check current signature state
    if (hasSignature(claudeHelperBin)) {
      console.log('AfterPack: Binary has existing signature, attempting to strip...');
      const stripped = stripSignature(claudeHelperBin);
      if (!stripped) {
        console.log('AfterPack: WARNING: Could not strip signature. Build may fail during codesign.');
        console.log('AfterPack: Ensure build-claude-helper.sh strips signatures before lipo.');
      }
    } else {
      console.log('AfterPack: Binary has no signature (already stripped during build)');
    }
  } else {
    console.log('AfterPack: claude-helper binary not found at:', claudeHelperBin);
  }

  console.log('AfterPack: Complete');
};
