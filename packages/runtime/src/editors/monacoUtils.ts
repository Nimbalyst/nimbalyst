/**
 * Monaco Editor Utilities
 *
 * Shared utilities for Monaco editor integration.
 */

import type { ConfigTheme } from 'rexical';

/**
 * Map Nimbalyst theme to Monaco editor theme
 *
 * Monaco provides these built-in themes:
 * - 'vs' - Light theme
 * - 'vs-dark' - Dark theme
 * - 'hc-black' - High contrast dark theme
 * - 'hc-light' - High contrast light theme
 *
 * We use 'vs' for light and 'vs-dark' for our dark variants.
 */
export function getMonacoTheme(nimbalystTheme: ConfigTheme): string {
  switch (nimbalystTheme) {
    case 'light':
      return 'vs';

    case 'dark':
    case 'crystal-dark':
      return 'vs-dark';

    case 'auto':
      // Auto theme should check system preference
      // For now, default to light (TabEditor should resolve 'auto' before passing to Monaco)
      return 'vs';

    default:
      return 'vs';
  }
}

/**
 * Browser-compatible path utilities
 */
function getExtname(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastDot > lastSlash && lastDot > 0) {
    return filePath.substring(lastDot);
  }
  return '';
}

function getBasename(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
}

/**
 * Map file extension to Monaco editor language ID
 */
export function getMonacoLanguage(filePath: string): string {
  const ext = getExtname(filePath).toLowerCase();

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.d.ts': 'typescript',

    // Web
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',

    // Data formats
    '.json': 'json',
    '.jsonc': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'ini',

    // Python
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',

    // Shell
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.fish': 'shell',

    // C/C++
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',

    // Other compiled languages
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.cs': 'csharp',

    // Scripting
    '.rb': 'ruby',
    '.php': 'php',
    '.pl': 'perl',
    '.lua': 'lua',

    // Functional
    '.hs': 'haskell',
    '.scala': 'scala',
    '.clj': 'clojure',
    '.fs': 'fsharp',
    '.fsx': 'fsharp',

    // Markup/Config
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.dockerfile': 'dockerfile',
    '.dockerignore': 'plaintext',
    '.gitignore': 'plaintext',
    '.env': 'plaintext',

    // Text
    '.txt': 'plaintext',
    '.log': 'plaintext',
  };

  // Special case: files without extensions
  if (!ext) {
    const basename = getBasename(filePath);
    if (basename === 'Dockerfile') return 'dockerfile';
    if (basename === 'Makefile') return 'makefile';
    if (basename === 'Gemfile') return 'ruby';
    return 'plaintext';
  }

  return languageMap[ext] || 'plaintext';
}
