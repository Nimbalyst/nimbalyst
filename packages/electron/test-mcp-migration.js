#!/usr/bin/env node
/**
 * Manual test script to verify MCP config migration from
 * ~/.config/claude/mcp.json to ~/.claude.json
 *
 * Run with: node packages/electron/test-mcp-migration.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const homeDir = os.homedir();
const legacyConfigPath = path.join(homeDir, '.config', 'claude', 'mcp.json');
const newConfigPath = path.join(homeDir, '.claude.json');

console.log('MCP Configuration Migration Test');
console.log('=================================\n');

// Check legacy config
console.log('1. Checking legacy config location:');
console.log(`   ${legacyConfigPath}`);
if (fs.existsSync(legacyConfigPath)) {
  try {
    const legacyContent = fs.readFileSync(legacyConfigPath, 'utf8');
    const legacyConfig = JSON.parse(legacyContent);
    const serverCount = Object.keys(legacyConfig.mcpServers || {}).length;
    console.log(`   ✓ Found ${serverCount} servers in legacy config`);
    console.log(`   Servers: ${Object.keys(legacyConfig.mcpServers || {}).join(', ')}`);
  } catch (error) {
    console.log(`   ✗ Error reading legacy config: ${error.message}`);
  }
} else {
  console.log('   - Legacy config does not exist');
}

console.log('');

// Check new config
console.log('2. Checking new config location:');
console.log(`   ${newConfigPath}`);
if (fs.existsSync(newConfigPath)) {
  try {
    const newContent = fs.readFileSync(newConfigPath, 'utf8');
    const newConfig = JSON.parse(newContent);
    const serverCount = Object.keys(newConfig.mcpServers || {}).length;
    console.log(`   ✓ Found ${serverCount} servers in new config`);
    if (serverCount > 0) {
      console.log(`   Servers: ${Object.keys(newConfig.mcpServers).join(', ')}`);
    }

    // Check if other settings are preserved
    const otherKeys = Object.keys(newConfig).filter(k => k !== 'mcpServers');
    if (otherKeys.length > 0) {
      console.log(`   ✓ Other Claude Code settings preserved (${otherKeys.length} keys)`);
    }
  } catch (error) {
    console.log(`   ✗ Error reading new config: ${error.message}`);
  }
} else {
  console.log('   - New config does not exist');
}

console.log('');

// Provide migration status
console.log('3. Migration Status:');
const legacyExists = fs.existsSync(legacyConfigPath);
const newExists = fs.existsSync(newConfigPath);

if (legacyExists && newExists) {
  try {
    const legacyConfig = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8'));
    const newConfig = JSON.parse(fs.readFileSync(newConfigPath, 'utf8'));

    const legacyServers = Object.keys(legacyConfig.mcpServers || {});
    const newServers = Object.keys(newConfig.mcpServers || {});

    const allLegacyInNew = legacyServers.every(s => newServers.includes(s));

    if (allLegacyInNew && newServers.length > 0) {
      console.log('   ✓ All legacy servers are present in new config');
      console.log('   Migration appears successful!');
    } else if (legacyServers.length === 0 && newServers.length > 0) {
      console.log('   ✓ New config has servers (no legacy servers to migrate)');
    } else if (legacyServers.length > 0 && newServers.length === 0) {
      console.log('   ⚠ Legacy servers exist but not in new config');
      console.log('   Migration needed - start Nimbalyst to trigger migration');
    } else {
      console.log('   ⚠ Some servers may be missing');
      console.log(`   Legacy: ${legacyServers.join(', ')}`);
      console.log(`   New: ${newServers.join(', ')}`);
    }
  } catch (error) {
    console.log(`   ✗ Error comparing configs: ${error.message}`);
  }
} else if (legacyExists && !newExists) {
  console.log('   ⚠ Legacy config exists but new config does not');
  console.log('   Migration will occur when Nimbalyst starts');
} else if (!legacyExists && newExists) {
  console.log('   ✓ Using new config location (no legacy config)');
} else {
  console.log('   - No MCP configs found');
}

console.log('');
console.log('To test migration:');
console.log('1. Ensure ~/.config/claude/mcp.json has MCP servers');
console.log('2. Start Nimbalyst');
console.log('3. Check that ~/.claude.json now has those servers');
console.log('4. Verify other Claude Code settings are preserved');
