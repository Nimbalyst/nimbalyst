import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

// Clean dist directory
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Copy static files
const staticFiles = [
  'manifest.json',
  'src/popup/popup.html',
  'src/popup/popup.css',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

for (const file of staticFiles) {
  const srcPath = path.join(__dirname, file);
  const destPath = path.join(distDir, file);

  if (fs.existsSync(srcPath)) {
    const destDir = path.dirname(destPath);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied: ${file}`);
  }
}

// Build configuration
const buildConfig = {
  entryPoints: [
    'src/background/background.js',
    'src/content/content.js',
    'src/popup/popup.js',
  ],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

if (isWatch) {
  const context = await esbuild.context(buildConfig);
  await context.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildConfig);
  console.log('Build complete!');
}
