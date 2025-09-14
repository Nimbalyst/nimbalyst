#!/usr/bin/env node

/**
 * Build script to bundle the PGLite worker with its dependencies
 * This creates a self-contained worker file that can run outside app.asar
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function buildWorker() {
  const outDir = path.join(__dirname, '../out');

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/main/database/worker.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(outDir, 'worker.bundle.js'),
      external: [
        'electron',
        'worker_threads', // Don't bundle worker_threads, it's a Node.js built-in
        'path',          // Don't bundle path, it's a Node.js built-in
        'fs',            // Don't bundle fs if used
        'crypto',        // Don't bundle crypto if used
        // Bundle PGLite so it's available in the packaged app
      ],
      minify: false,
      sourcemap: false,
      format: 'cjs',
      loader: {
        '.node': 'file',
        '.data': 'binary',  // Embed .data files as binary
        '.wasm': 'binary',  // Embed .wasm files as binary
      },
      define: {
        // Make sure process.env is available
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      },
    });

    console.log('Worker bundle created successfully at out/worker.bundle.js');
  } catch (error) {
    console.error('Failed to build worker bundle:', error);
    process.exit(1);
  }
}

buildWorker();