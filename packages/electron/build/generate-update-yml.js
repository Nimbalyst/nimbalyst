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

// Function to generate latest-mac.yml
function generateMacYml() {
  // Find the DMG and ZIP files
  const dmgFile = `${productName}-${version}-arm64.dmg`;
  const zipFile = `${productName}-${version}-arm64.zip`;
  
  const dmgPath = path.join(releaseDir, dmgFile);
  const zipPath = path.join(releaseDir, zipFile);
  
  const files = [];
  
  // Add DMG file if it exists
  if (fs.existsSync(dmgPath)) {
    files.push({
      url: dmgFile,
      sha512: calculateSHA512(dmgPath),
      size: getFileSize(dmgPath)
    });
  }
  
  // Add ZIP file if it exists
  if (fs.existsSync(zipPath)) {
    files.push({
      url: zipFile,
      sha512: calculateSHA512(zipPath),
      size: getFileSize(zipPath)
    });
  }
  
  if (files.length === 0) {
    console.error('No DMG or ZIP files found in release directory');
    return false;
  }
  
  // Generate the YAML content
  const yamlContent = {
    version: version,
    files: files,
    path: files[0].url, // Primary file
    sha512: files[0].sha512,
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