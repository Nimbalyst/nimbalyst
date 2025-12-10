import { execSync } from 'child_process';

/**
 * Cached result of git availability check.
 * null = not checked yet
 */
let gitAvailableCache: boolean | null = null;

/**
 * Check if git is available on the system without triggering the macOS
 * "install command line developer tools" dialog.
 *
 * On macOS, /usr/bin/git is a shim that triggers an installation dialog if
 * Xcode CLI tools aren't installed. We avoid this by first checking if the
 * tools are installed using xcode-select.
 *
 * The result is cached for the lifetime of the application.
 *
 * @returns true if git is available, false otherwise
 */
export function isGitAvailable(): boolean {
  if (gitAvailableCache !== null) {
    return gitAvailableCache;
  }

  gitAvailableCache = checkGitAvailable();
  return gitAvailableCache;
}

/**
 * Internal function to check git availability.
 */
function checkGitAvailable(): boolean {
  // On macOS, check if Xcode CLI tools are installed first to avoid
  // triggering the installation dialog
  if (process.platform === 'darwin') {
    try {
      // xcode-select -p returns the developer directory path if tools are installed,
      // or exits with code 2 if not installed. It never shows a dialog.
      execSync('xcode-select -p', {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // Tools are installed, git should be available
    } catch {
      // xcode-select failed - CLI tools not installed, git is not available
      return false;
    }
  }

  // Now try to run git --version
  // On macOS this is safe because we already verified CLI tools are installed
  // On other platforms this is the primary check
  try {
    execSync('git --version', {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset the git availability cache.
 * Primarily used for testing.
 */
export function resetGitAvailableCache(): void {
  gitAvailableCache = null;
}
