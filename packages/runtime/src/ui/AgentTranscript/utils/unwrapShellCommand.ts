/** Regex to detect shell-wrapped commands like "/bin/zsh -lc 'actual command'" */
const SHELL_WRAPPER_REGEX = /^\/(?:bin|usr\/bin)\/(?:bash|zsh|sh)\s+-l?c\s+([\s\S]+)$/;

/**
 * Unwrap a shell-wrapped command for display purposes.
 * Codex wraps commands like: /bin/zsh -lc "sed -n '1,260p' file.ts"
 * This strips the wrapper to show just: sed -n '1,260p' file.ts
 *
 * Display-only — does not modify stored data.
 */
export function unwrapShellCommand(command: string): string {
  const match = command.match(SHELL_WRAPPER_REGEX);
  if (match) {
    return match[1].replace(/^['"]|['"]$/g, '');
  }
  return command;
}
