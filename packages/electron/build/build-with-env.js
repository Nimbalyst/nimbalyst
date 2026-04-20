#!/usr/bin/env node

/**
 * Wrapper script to load .env file before running electron-builder
 */

const path = require('path');
const { execSync, spawn } = require('child_process');

// Validate extraResources before building
try {
  execSync('node build/validate-extra-resources.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}

// Store SKIP_NOTARIZE before loading .env (which might override it)
const skipNotarize = process.env.SKIP_NOTARIZE;

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Restore SKIP_NOTARIZE if it was set before dotenv
if (skipNotarize) {
  process.env.SKIP_NOTARIZE = skipNotarize;
}

// Get command line arguments (everything after the script name)
const args = process.argv.slice(2);

// Run electron-builder with the loaded environment
const electronBuilder = spawn('npx', ['electron-builder', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: true
});

electronBuilder.on('close', (code) => {
  process.exit(code);
});