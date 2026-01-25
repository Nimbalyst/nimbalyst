/**
 * Monaco Editor Utilities
 *
 * Shared utilities for Monaco editor integration.
 */

import type { ConfigTheme } from 'rexical';

/**
 * Map of extension theme IDs to their Monaco theme names.
 * These must match the themes defined in monacoConfig.ts.
 */
const EXTENSION_THEME_TO_MONACO: Record<string, string> = {
  'sample-themes:solarized-light': 'solarized-light',
  'sample-themes:solarized-dark': 'solarized-dark',
  'sample-themes:monokai': 'monokai',
};

/**
 * Map Nimbalyst theme to Monaco editor theme
 *
 * Monaco provides these built-in themes:
 * - 'vs' - Light theme
 * - 'vs-dark' - Dark theme
 * - 'hc-black' - High contrast dark theme
 * - 'hc-light' - High contrast light theme
 *
 * We also define custom themes for extension themes like Solarized and Monokai.
 *
 * @param nimbalystTheme - The Nimbalyst theme (built-in or extension)
 * @param isDark - Optional: whether the theme is dark (required for unknown extension themes)
 * @param extensionThemeId - Optional: the full extension theme ID for custom theme mapping
 */
export function getMonacoTheme(nimbalystTheme: ConfigTheme, isDark?: boolean, extensionThemeId?: string): string {
  // Check if there's a custom Monaco theme for this extension theme
  if (extensionThemeId && EXTENSION_THEME_TO_MONACO[extensionThemeId]) {
    return EXTENSION_THEME_TO_MONACO[extensionThemeId];
  }

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
      // Extension themes or unknown themes - use isDark flag if provided
      if (isDark !== undefined) {
        return isDark ? 'vs-dark' : 'vs';
      }
      // Fall back to light for unknown themes
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
