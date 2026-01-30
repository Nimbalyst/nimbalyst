#!/usr/bin/env node

/**
 * Generate update metadata files for electron-updater
 * This script creates the latest-mac.yml, latest.yml, and other update files
 * needed for auto-update functionality
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Read package.json to get version
const packageJson = require('../package.json');
const version = packageJson.version;
const productName = packageJson.build.productName || 'Preditor';

// Release directory
const releaseDir = path.join(__dirname, '..', 'release');

// Function to calculate SHA512 hash
function calculateSHA512(filePath) {
  const hash = crypto.createHash('sha512');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('base64');
}

// Function to get file size
function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

// Function to get release notes
function getReleaseNotes() {
  const releaseNotesPath = path.join(releaseDir, 'RELEASE_NOTES.md');
  if (fs.existsSync(releaseNotesPath)) {
    return fs.readFileSync(releaseNotesPath, 'utf8').trim();
  }
  // Fallback: get recent git commits
  try {
    const commits = execSync('git log --oneline -5 --pretty=format:"- %s"', { encoding: 'utf8' });
    return `## Recent Changes\n\n${commits}`;
  } catch (e) {
    return 'New release available';
  }
}

// Function to generate latest-mac.yml
function generateMacYml() {
  // Use standard electron-builder filenames with architecture suffixes.
  // electron-updater requires these suffixes to correctly route updates.
  //
  // Note: afterAllArtifactBuild.js also creates copies without the arch suffix
  // (e.g., Nimbalyst-macOS.dmg) for backwards-compatible download links,
  // but those are NOT referenced in the yml - only the arch-suffixed files are.

  const files = [];

  // Apple Silicon files
  const arm64Zip = `${productName}-macOS-arm64.zip`;
  const arm64ZipPath = path.join(releaseDir, arm64Zip);
  const arm64Dmg = `${productName}-macOS-arm64.dmg`;
  const arm64DmgPath = path.join(releaseDir, arm64Dmg);

  // Intel files
  const x64Zip = `${productName}-macOS-x64.zip`;
  const x64ZipPath = path.join(releaseDir, x64Zip);
  const x64Dmg = `${productName}-macOS-x64.dmg`;
  const x64DmgPath = path.join(releaseDir, x64Dmg);

  // Add Apple Silicon ZIP (primary)
  if (fs.existsSync(arm64ZipPath)) {
    files.push({
      url: arm64Zip,
      sha512: calculateSHA512(arm64ZipPath),
      size: getFileSize(arm64ZipPath),
      arch: 'arm64'
    });
  }

  // Add Intel ZIP
  if (fs.existsSync(x64ZipPath)) {
    files.push({
      url: x64Zip,
      sha512: calculateSHA512(x64ZipPath),
      size: getFileSize(x64ZipPath),
      arch: 'x64'
    });
  }

  // Add Apple Silicon DMG
  if (fs.existsSync(arm64DmgPath)) {
    files.push({
      url: arm64Dmg,
      sha512: calculateSHA512(arm64DmgPath),
      size: getFileSize(arm64DmgPath),
      arch: 'arm64'
    });
  }

  // Add Intel DMG
  if (fs.existsSync(x64DmgPath)) {
    files.push({
      url: x64Dmg,
      sha512: calculateSHA512(x64DmgPath),
      size: getFileSize(x64DmgPath),
      arch: 'x64'
    });
  }

  if (files.length === 0) {
    console.error('No DMG or ZIP files found in release directory');
    return false;
  }

  // Get release notes
  const releaseNotes = getReleaseNotes();

  // Primary file is the Apple Silicon ZIP (first in list)
  const primaryFile = files[0];

  // Generate the YAML content
  const yamlContent = {
    version: version,
    files: files,
    path: primaryFile.url,
    sha512: primaryFile.sha512,
    releaseDate: new Date().toISOString(),
    releaseNotes: releaseNotes
  };

  // Convert to YAML format
  let yamlString = `version: ${yamlContent.version}\n`;
  yamlString += `files:\n`;
  yamlContent.files.forEach(file => {
    yamlString += `  - url: ${file.url}\n`;
    yamlString += `    sha512: ${file.sha512}\n`;
    yamlString += `    size: ${file.size}\n`;
    if (file.arch) {
      yamlString += `    arch: ${file.arch}\n`;
    }
  });
  yamlString += `path: ${yamlContent.path}\n`;
  yamlString += `sha512: ${yamlContent.sha512}\n`;
  yamlString += `releaseDate: '${yamlContent.releaseDate}'\n`;
  // Add release notes as multi-line string
  yamlString += `releaseNotes: |\n`;
  yamlContent.releaseNotes.split('\n').forEach(line => {
    yamlString += `  ${line}\n`;
  });

  // Write the file
  const outputPath = path.join(releaseDir, 'latest-mac.yml');
  fs.writeFileSync(outputPath, yamlString);
  console.log(`Generated ${outputPath}`);

  return true;
}

// Function to generate latest.yml (for Windows/Linux)
function generateLatestYml() {
  // Find the exe file for Windows
  const exeFile = `${productName} Setup ${version}.exe`;
  const exePath = path.join(releaseDir, exeFile);
  
  if (fs.existsSync(exePath)) {
    const yamlContent = {
      version: version,
      files: [{
        url: exeFile,
        sha512: calculateSHA512(exePath),
        size: getFileSize(exePath)
      }],
      path: exeFile,
      sha512: calculateSHA512(exePath),
      releaseDate: new Date().toISOString()
    };
    
    // Convert to YAML format
    let yamlString = `version: ${yamlContent.version}\n`;
    yamlString += `files:\n`;
    yamlContent.files.forEach(file => {
      yamlString += `  - url: ${file.url}\n`;
      yamlString += `    sha512: ${file.sha512}\n`;
      yamlString += `    size: ${file.size}\n`;
    });
    yamlString += `path: ${yamlContent.path}\n`;
    yamlString += `sha512: ${yamlContent.sha512}\n`;
    yamlString += `releaseDate: '${yamlContent.releaseDate}'\n`;
    
    // Write the file
    const outputPath = path.join(releaseDir, 'latest.yml');
    fs.writeFileSync(outputPath, yamlString);
    console.log(`Generated ${outputPath}`);
  }
}

// Check if release directory exists
if (!fs.existsSync(releaseDir)) {
  console.error('Release directory does not exist:', releaseDir);
  process.exit(1);
}

// Generate update files
console.log(`Generating update metadata files for version ${version}...`);

const macSuccess = generateMacYml();
generateLatestYml();

if (!macSuccess) {
  console.error('Failed to generate update metadata files');
  process.exit(1);
}

console.log('Update metadata files generated successfully');