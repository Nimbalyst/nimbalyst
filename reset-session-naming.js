#!/usr/bin/env node
/**
 * Utility script to reset has_been_named flag for testing session naming
 * Usage: node reset-session-naming.js <session-id>
 */

const { PGlite } = require('@electric-sql/pglite');
const path = require('path');
const os = require('os');

const sessionId = process.argv[2];

if (!sessionId) {
  console.error('Usage: node reset-session-naming.js <session-id>');
  process.exit(1);
}

async function resetSessionNaming() {
  const dataDir = path.join(
    os.homedir(),
    'Library/Application Support/@nimbalyst/electron/pglite-db'
  );

  console.log(`Connecting to database at: ${dataDir}`);

  const db = new PGlite({
    dataDir,
    debug: 0
  });

  await db.waitReady;

  console.log(`Resetting has_been_named for session: ${sessionId}`);

  const result = await db.query(
    'UPDATE ai_sessions SET has_been_named = false WHERE id = $1 RETURNING id, title, has_been_named',
    [sessionId]
  );

  if (result.rows.length === 0) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  console.log('Session updated:');
  console.log(result.rows[0]);

  await db.close();
  console.log('\nDone! Session can now be renamed.');
}

resetSessionNaming().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
