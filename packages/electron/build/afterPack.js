const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  console.log('AfterPack: Fixing Sharp native dependencies...');
  
  const appOutDir = context.appOutDir;
  const platform = context.packager.platform.name;
  
  if (platform !== 'mac') {
    console.log('AfterPack: Skipping Sharp fix - not macOS');
    return;
  }
  
  const resourcesPath = path.join(appOutDir, 'Preditor.app/Contents/Resources');
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked/node_modules');
  
  // Source: where libvips actually is
  const libvipsSource = path.join(unpackedPath, '@img/sharp-libvips-darwin-arm64');
  
  // Target: where Sharp expects it (relative to sharp-darwin-arm64)
  const sharpNodeModules = path.join(unpackedPath, 'sharp/node_modules/@img');
  const libvipsTarget = path.join(sharpNodeModules, 'sharp-libvips-darwin-arm64');
  
  if (!fs.existsSync(libvipsSource)) {
    console.log('AfterPack: libvips source not found, skipping:', libvipsSource);
    return;
  }
  
  if (fs.existsSync(libvipsTarget)) {
    console.log('AfterPack: libvips target already exists, skipping');
    return;
  }
  
  console.log('AfterPack: Creating symlink from', libvipsTarget, 'to', libvipsSource);
  
  // Ensure parent directory exists
  if (!fs.existsSync(sharpNodeModules)) {
    fs.mkdirSync(sharpNodeModules, { recursive: true });
  }
  
  // Create symlink
  fs.symlinkSync(libvipsSource, libvipsTarget, 'dir');
  
  console.log('AfterPack: Sharp dependencies fixed successfully');
};
