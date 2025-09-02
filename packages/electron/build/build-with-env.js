#!/usr/bin/env node

/**
 * Wrapper script to load .env file before running electron-builder
 */

const path = require('path');
const { spawn } = require('child_process');

// Load environment variables from .env file
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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