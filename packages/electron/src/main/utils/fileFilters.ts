/**
 * Centralized file and directory filtering logic
 *
 * This module provides consistent filtering across all file operations
 * to ensure we exclude worktrees, build artifacts, and other undesired files/directories.
 */

// File extensions to exclude from search and scanning
export const EXCLUDED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.db', '.sqlite', '.lock'
]);

// Directories to exclude from scanning and search
export const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.worktrees',     // Git worktrees - CRITICAL: prevents duplicate file references
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.vscode',
  '.idea',
  '__pycache__',
  '.DS_Store'
]);

/**
 * Check if a file should be excluded based on extension
 */
export function shouldExcludeFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return EXCLUDED_EXTENSIONS.has(ext);
}

/**
 * Check if a directory should be excluded
 */
export function shouldExcludeDir(dirName: string): boolean {
  return EXCLUDED_DIRS.has(dirName);
}

/**
 * Check if a path component contains an excluded directory
 * Useful for checking full paths to ensure no part of the path contains excluded dirs
 */
export function pathContainsExcludedDir(fullPath: string): boolean {
  const parts = fullPath.split(/[/\\]/);
  return parts.some(part => shouldExcludeDir(part));
}

/**
 * Glob patterns for excluding directories
 */
export const GLOB_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.worktrees/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/__pycache__/**',
  '**/.DS_Store/**'
];

/**
 * Ripgrep glob arguments for excluding directories (as plain string to avoid bundler issues)
 */
export const RIPGREP_EXCLUDE_ARGS = '--glob !**/node_modules/** --glob !**/.git/** --glob !**/.worktrees/** --glob !**/dist/** --glob !**/build/** --glob !**/out/** --glob !**/.next/** --glob !**/.nuxt/** --glob !**/.cache/** --glob !**/coverage/** --glob !**/.vscode/** --glob !**/.idea/** --glob !**/__pycache__/** --glob !**/.DS_Store/**';

/**
 * Find command prune arguments for excluding directories
 */
export const FIND_PRUNE_ARGS = '-path "*/node_modules/*" -prune -o -path "*/.git/*" -prune -o -path "*/.worktrees/*" -prune -o -path "*/dist/*" -prune -o -path "*/build/*" -prune -o -path "*/out/*" -prune -o -path "*/.next/*" -prune -o -path "*/.nuxt/*" -prune -o -path "*/.cache/*" -prune -o -path "*/coverage/*" -prune -o -path "*/.vscode/*" -prune -o -path "*/.idea/*" -prune -o -path "*/__pycache__/*" -prune -o -path "*/.DS_Store/*" -prune';
