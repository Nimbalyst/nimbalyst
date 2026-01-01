/**
 * ShellDetector - Cross-platform shell detection utility
 *
 * Detects the user's default shell on macOS, Linux, and Windows.
 * On macOS, uses Directory Services for accurate detection (not just $SHELL).
 * On Windows, prefers PowerShell Core, then PowerShell, then cmd.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface ShellInfo {
  path: string;
  name: string;
  args: string[];
}

export class ShellDetector {
  /**
   * Get the user's default shell with appropriate arguments
   */
  static getDefaultShell(): ShellInfo {
    if (process.platform === 'win32') {
      return this.detectWindowsShell();
    }
    return this.detectUnixShell();
  }

  /**
   * Detect shell on Unix-like systems (macOS, Linux)
   */
  private static detectUnixShell(): ShellInfo {
    // Try SHELL environment variable first
    const envShell = process.env.SHELL;
    if (envShell && fs.existsSync(envShell)) {
      return {
        path: envShell,
        name: path.basename(envShell),
        args: ['-i'], // Interactive mode for proper prompt
      };
    }

    // macOS: Query Directory Services for accurate shell detection
    if (process.platform === 'darwin') {
      try {
        const username = os.userInfo().username;
        const result = execSync(`dscl . -read /Users/${username} UserShell`, {
          encoding: 'utf8',
          timeout: 5000,
        });
        const match = result.match(/UserShell:\s*(.+)/);
        if (match?.[1] && fs.existsSync(match[1].trim())) {
          const shellPath = match[1].trim();
          return {
            path: shellPath,
            name: path.basename(shellPath),
            args: ['-i'],
          };
        }
      } catch {
        // Fall through to fallback
      }
    }

    // Linux: Check /etc/passwd or fallback to common shells
    if (process.platform === 'linux') {
      try {
        const passwdContent = fs.readFileSync('/etc/passwd', 'utf8');
        const username = os.userInfo().username;
        const userLine = passwdContent
          .split('\n')
          .find((line) => line.startsWith(`${username}:`));
        if (userLine) {
          const shellPath = userLine.split(':').pop()?.trim();
          if (shellPath && fs.existsSync(shellPath)) {
            return {
              path: shellPath,
              name: path.basename(shellPath),
              args: ['-i'],
            };
          }
        }
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback to common shells
    const commonShells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
    for (const shell of commonShells) {
      if (fs.existsSync(shell)) {
        return {
          path: shell,
          name: path.basename(shell),
          args: ['-i'],
        };
      }
    }

    // Last resort
    return {
      path: '/bin/sh',
      name: 'sh',
      args: ['-i'],
    };
  }

  /**
   * Detect shell on Windows
   */
  private static detectWindowsShell(): ShellInfo {
    // Try PowerShell Core (pwsh) first - it's the modern cross-platform version
    const pwsh = this.findInPath('pwsh.exe');
    if (pwsh) {
      return {
        path: pwsh,
        name: 'pwsh',
        args: ['-NoExit', '-NoLogo'],
      };
    }

    // Try Windows PowerShell
    const powershell = this.findInPath('powershell.exe');
    if (powershell) {
      return {
        path: powershell,
        name: 'powershell',
        args: ['-NoExit', '-NoLogo'],
      };
    }

    // Fall back to cmd
    return {
      path: 'cmd.exe',
      name: 'cmd',
      args: [],
    };
  }

  /**
   * Find an executable in the PATH
   */
  private static findInPath(exe: string): string | null {
    const pathEnv = process.env.PATH || '';
    const paths = pathEnv.split(path.delimiter);

    for (const p of paths) {
      const fullPath = path.join(p, exe);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }
}
