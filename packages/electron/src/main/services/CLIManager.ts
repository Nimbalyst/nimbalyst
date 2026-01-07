import { spawn, ChildProcess, exec, execSync } from 'child_process';
import { ipcMain, BrowserWindow, shell } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { simpleGit } from 'simple-git';
import {AnalyticsService} from "./analytics/AnalyticsService.ts";

const execAsync = promisify(exec);

interface InstallationStatus {
  installed: boolean;
  version?: string;
  updateAvailable?: boolean;
  path?: string;
  latestVersion?: string;
  claudeDesktopVersion?: string; // Version installed by Claude Desktop (if any)
}

export interface ClaudeForWindowsInstallation {
  isPlatformWindows: boolean;
  gitVersion?: string;
  claudeCodeVersion?: string;
}

interface NodeInstallProgress {
  percent: number;
  status: string;
  log?: string;
}

interface InstallOptions {
  localInstall?: boolean;
}

type CLITool = 'claude-code' | 'openai-codex';

// CLI commands and their npm packages
const CLI_PACKAGES: Record<CLITool, string> = {
  'claude-code': '@anthropic-ai/claude-agent-sdk',  // Claude Agent SDK (renamed from claude-code)
  'openai-codex': '@openai/codex'                    // OpenAI Codex package (actual on npm!)
};

const CLI_COMMANDS: Record<CLITool, string> = {
  'claude-code': 'claude',     // The actual command once installed
  'openai-codex': 'codex'      // The actual command once installed
};

export class CLIManager {
  private installingTools = new Map<CLITool, ChildProcess>();
  private npmAvailable: boolean | null = null;

  constructor() {
    this.setupIPCHandlers();
  }

  private setupIPCHandlers() {
    ipcMain.handle('cli:checkInstallation', async (_event, tool: CLITool) => {
      return this.checkInstallation(tool);
    });

    ipcMain.handle('cli:install', async (_event, tool: CLITool, options: InstallOptions) => {
      return this.install(tool, options);
    });

    ipcMain.handle('cli:uninstall', async (_event, tool: CLITool) => {
      return this.uninstall(tool);
    });

    ipcMain.handle('cli:upgrade', async (_event, tool: CLITool) => {
      return this.upgrade(tool);
    });

    ipcMain.handle('cli:checkNpmAvailable', async () => {
      return this.checkNpmAvailable();
    });

    ipcMain.handle('cli:installNodeJs', async () => {
      return this.installNodeJs();
    });

    ipcMain.handle('cli:checkClaudeCodeWindowsInstallation', async (): Promise<ClaudeForWindowsInstallation> => {
      return this.checkClaudeCodeWindowsInstallation();
    });
  }

  async checkNpmAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    // Don't use cache - always check fresh to detect new installations
    console.log('[CLIManager] Checking npm availability...');
    console.log('[CLIManager] Current PATH:', process.env.PATH);
    console.log('[CLIManager] Enhanced PATH:', this.getEnhancedPath());

    try {

      // Try multiple approaches to find npm
      const enhancedPath = this.getEnhancedPath();

      // First try with enhanced PATH
      try {
        const version = execSync('npm --version', {
          encoding: 'utf8',
          env: { ...process.env, PATH: enhancedPath },
          timeout: 5000
        }).trim();
        console.log('[CLIManager] ✓ npm found via enhanced PATH, version:', version);
        this.npmAvailable = true;
        return { available: true, version };
      } catch (e1: any) {
        console.log('[CLIManager] npm not found with enhanced PATH:', e1.message);
      }

      // Try with system PATH
      try {
        const version = execSync('npm --version', {
          encoding: 'utf8',
          timeout: 5000
        }).trim();
        console.log('[CLIManager] ✓ npm found in system PATH, version:', version);
        this.npmAvailable = true;
        return { available: true, version };
      } catch (e2: any) {
        console.log('[CLIManager] npm not found in system PATH:', e2.message);
      }

      // Try finding npm with where/which
      try {
        const findCommand = process.platform === 'win32' ? 'where' : 'which';
        const npmPath = execSync(`${findCommand} npm`, {
          encoding: 'utf8',
          env: { ...process.env, PATH: enhancedPath },
          timeout: 5000
        }).trim().split('\n')[0]; // Get first result

        console.log('[CLIManager] Found npm at:', npmPath);

        const version = execSync(`"${npmPath}" --version`, {
          encoding: 'utf8',
          timeout: 5000
        }).trim();
        console.log('[CLIManager] ✓ npm version:', version);
        this.npmAvailable = true;
        return { available: true, version };
      } catch (e3: any) {
        console.log('[CLIManager] which/where npm failed:', e3.message);
      }

      // Try common npm paths directly
      const commonPaths = process.platform === 'win32' ? [
        'C:\\Program Files\\nodejs\\npm.cmd',
        'C:\\Program Files (x86)\\nodejs\\npm.cmd',
        path.join(process.env.APPDATA || '', 'npm', 'npm.cmd'),
        path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm', 'npm.cmd')
      ] : [
        '/usr/local/bin/npm',
        '/usr/bin/npm',
        '/opt/homebrew/bin/npm',
        path.join(os.homedir(), '.npm-global', 'bin', 'npm'),
        '/snap/bin/npm'
      ];

      console.log('[CLIManager] Checking common paths:', commonPaths);

      for (const npmPath of commonPaths) {
        try {
          // Check if file exists
          await fs.access(npmPath, fs.constants.F_OK);
          console.log('[CLIManager] Found npm file at:', npmPath);

          const version = execSync(`"${npmPath}" --version`, {
            encoding: 'utf8',
            timeout: 5000
          }).trim();
          console.log('[CLIManager] ✓ npm at', npmPath, 'version:', version);
          this.npmAvailable = true;
          return { available: true, version };
        } catch (e) {
          // Continue checking
        }
      }

      // Not found anywhere
      this.npmAvailable = false;
      console.error('[CLIManager] ✗ npm not available after checking all paths');
      return {
        available: false,
        error: 'npm is not installed. Please install Node.js from nodejs.org to use this feature.'
      };
    } catch (error: any) {
      this.npmAvailable = false;
      console.error('[CLIManager] Error checking npm availability:', error.message);
      console.error('[CLIManager] Stack:', error.stack);
      return {
        available: false,
        error: 'npm is not installed. Please install Node.js from nodejs.org to use this feature.'
      };
    }
  }

  async checkGitInstallation(): Promise<{ gitInstalled: boolean; gitVersion?: string }> {
    try {
      const gitVersion = await simpleGit().version();
      if (!gitVersion.installed) {
        return { gitInstalled: false };
      }
      return { gitInstalled: true, gitVersion: String(gitVersion) };
    } catch (e) {
      return { gitInstalled: false };
    }
  }

  async checkClaudeCodeWindowsInstallation(): Promise<ClaudeForWindowsInstallation> {
    console.log('[CLIManager] Checking Claude for Windows installation...');
    if (process.platform !== 'win32') {
      return { isPlatformWindows: false };
    }
    const {gitVersion} = await this.checkGitInstallation();

    // Check for claude executable in common locations
    const claudeExePaths = [
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'), // native installer places it here
      'claude.exe' // an older installation may be on the path
    ];

    for (const claudePath of claudeExePaths) {
      try {
        await fs.access(claudePath, fsSync.constants.X_OK);
        // Found it, get version
        const claudeCodeVersion = execSync(`"${claudePath}" --version`, { encoding: 'utf8' }).trim();
        return { isPlatformWindows: true, gitVersion, claudeCodeVersion };
      } catch (e) {
        // continue searching
      }
    }

    // Check for npm global installation (both old and new package names)
    // npm global on Windows is typically at %APPDATA%\npm\node_modules\
    const npmGlobalPaths = [
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code'),
    ];

    // Also try to get the dynamic npm root
    try {
      const globalNpmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      if (globalNpmRoot) {
        npmGlobalPaths.unshift(path.join(globalNpmRoot, '@anthropic-ai', 'claude-agent-sdk'));
        npmGlobalPaths.unshift(path.join(globalNpmRoot, '@anthropic-ai', 'claude-code'));
      }
    } catch (e) {
      // Ignore error, will use fallback paths
    }

    for (const packagePath of npmGlobalPaths) {
      try {
        const packageJsonPath = path.join(packagePath, 'package.json');
        await fs.access(packageJsonPath, fsSync.constants.R_OK);
        // Found it, get version from package.json
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        const claudeCodeVersion = packageJson.version || 'unknown';
        return { isPlatformWindows: true, gitVersion, claudeCodeVersion };
      } catch (e) {
        // continue searching
      }
    }

    return { isPlatformWindows: true, gitVersion };
  }

  async checkInstallation(tool: CLITool): Promise<InstallationStatus> {
    const command = CLI_COMMANDS[tool];

    // Special handling for claude - check common installation paths
    if (tool === 'claude-code') {
      // Get global npm root dynamically
      let globalNpmRoot: string | null = null;
      try {
          globalNpmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      } catch (error) {
        // Ignore error, will use fallback paths
      }

      // Check ONLY global npm locations that we manage
      // Don't check Claude Desktop's location - let user manage their own installation
      const claudePackagePaths = [
        // Dynamic global npm path (where we install it)
        ...(globalNpmRoot ? [path.join(globalNpmRoot, '@anthropic-ai', 'claude-agent-sdk')] : []),
        // Other common global locations
        path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-agent-sdk'),
        path.join(os.homedir(), '.config', 'yarn', 'global', 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
      ];

      // Also check if Claude Desktop has it installed (for display purposes)
      const claudeDesktopPath = path.join(os.homedir(), '.claude', 'local', 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
      let claudeDesktopVersion: string | null = null;
      try {
        const packageJsonPath = path.join(claudeDesktopPath, 'package.json');
        await fs.access(packageJsonPath, fs.constants.R_OK);
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        claudeDesktopVersion = packageJson.version;
      } catch (e) {
        // Claude Desktop version not found
      }

      // Check our managed global installations
      for (const claudePackagePath of claudePackagePaths) {
        try {
          // Check if the package exists by looking for package.json
          const packageJsonPath = path.join(claudePackagePath, 'package.json');
          await fs.access(packageJsonPath, fs.constants.R_OK);

          // Read the package.json to get version
          const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          const currentVersion = packageJson.version || 'unknown';

          // Check for latest version
          const latestVersion = await this.getLatestVersion(tool);
          const updateAvailable = !!(latestVersion && currentVersion !== 'unknown' &&
                                this.isNewerVersion(latestVersion, currentVersion));

          return {
            installed: true,
            version: currentVersion,
            updateAvailable,
            path: claudePackagePath,
            latestVersion: updateAvailable ? latestVersion : undefined,
            claudeDesktopVersion: claudeDesktopVersion ?? undefined // Include this for UI display
          };
        } catch (e) {
          // Continue checking other paths
        }
      }

      // If not found in global, return not installed (even if Claude Desktop has it)
      return {
        installed: false,
        claudeDesktopVersion: claudeDesktopVersion ?? undefined // Include this for UI display
      };
    }

    // Special handling for openai-codex - check common installation paths
    if (tool === 'openai-codex') {
      const codexPaths = [
        path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.15.1', 'bin', 'codex'),
        path.join(os.homedir(), '.openai', 'codex', 'bin', 'codex'),
        path.join(os.homedir(), '.local', 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex'
      ];

      for (const codexPath of codexPaths) {
        try {
          await fs.access(codexPath, fs.constants.X_OK);
          // Found it, get version
          const status = await new Promise<InstallationStatus>((resolve) => {
            const checkProcess = spawn(codexPath, ['--version'], {
              shell: false
            });

            let output = '';
            checkProcess.stdout?.on('data', (data) => {
              output += data.toString();
            });

            checkProcess.on('close', async (code) => {
              if (code === 0 && output) {
                const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
                const currentVersion = versionMatch ? versionMatch[1] : 'unknown';

                // Check for latest version
                const latestVersion = await this.getLatestVersion(tool);
                const updateAvailable = !!(latestVersion && currentVersion !== 'unknown' &&
                                      this.isNewerVersion(latestVersion, currentVersion));

                resolve({
                  installed: true,
                  version: currentVersion,
                  updateAvailable,
                  path: codexPath,
                  latestVersion: updateAvailable ? latestVersion : undefined
                });
              } else {
                resolve({ installed: false });
              }
            });

            checkProcess.on('error', () => {
              resolve({ installed: false });
            });

            setTimeout(() => {
              checkProcess.kill();
              resolve({ installed: false });
            }, 5000);
          });

          return status;
        } catch (e) {
          // Continue checking other paths
        }
      }
    }

    // Default check for other tools
    return new Promise((resolve) => {
      const checkProcess = spawn(command, ['--version'], {
        shell: true,
        env: { ...process.env, PATH: this.getEnhancedPath() }
      });

      let output = '';
      let errorOutput = '';

      checkProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      checkProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      checkProcess.on('close', (code) => {
        if (code === 0 && output) {
          // Extract version from output
          const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
          resolve({
            installed: true,
            version: versionMatch ? versionMatch[1] : 'unknown',
            updateAvailable: false,  // Would need to check npm registry
            path: 'global'
          });
        } else {
          resolve({ installed: false });
        }
      });

      checkProcess.on('error', () => {
        resolve({ installed: false });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        checkProcess.kill();
        resolve({ installed: false });
      }, 5000);
    });
  }

  async install(tool: CLITool, options: InstallOptions = {}): Promise<void> {
    // First check if npm is available
    const npmCheck = await this.checkNpmAvailable();
    if (!npmCheck.available) {
      throw new Error(npmCheck.error || 'npm is not available');
    }

    const packageName = CLI_PACKAGES[tool];
    const isLocal = options.localInstall;

    // Check if already installing
    if (this.installingTools.has(tool)) {
      throw new Error(`${tool} is already being installed`);
    }

    // Check if we're using Homebrew's npm and need to configure prefix
    try {
      const npmPath = execSync('which npm', { encoding: 'utf8' }).trim();
      const npmPrefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();

      console.log('[CLIManager] npm path:', npmPath);
      console.log('[CLIManager] npm prefix:', npmPrefix);

      if (npmPath.includes('/opt/homebrew') || npmPrefix.includes('/opt/homebrew')) {
        console.log('[CLIManager] Detected Homebrew npm, configuring user-local prefix...');

        // Set up user-local npm prefix
        const userNpmPrefix = path.join(os.homedir(), '.npm-global');

        // Create the directory if it doesn't exist
        try {
          await fs.mkdir(userNpmPrefix, { recursive: true });
          await fs.mkdir(path.join(userNpmPrefix, 'bin'), { recursive: true });
        } catch (e) {
          // Directory might already exist
        }

        // Configure npm to use this prefix
        execSync(`npm config set prefix '${userNpmPrefix}'`, { encoding: 'utf8' });
        console.log('[CLIManager] Set npm prefix to:', userNpmPrefix);

        this.sendProgressToRenderer(tool, {
          percent: 5,
          status: 'Configured npm for user-local installation',
          log: `npm prefix set to ${userNpmPrefix}`
        });

        // Add to PATH reminder
        this.sendProgressToRenderer(tool, {
          percent: 8,
          status: 'Important: Add to your PATH',
          log: `Add this to your ~/.zshrc or ~/.bash_profile:\nexport PATH="${userNpmPrefix}/bin:$PATH"`
        });
      }
    } catch (e) {
      console.log('[CLIManager] Could not check npm configuration:', e);
    }

    // Use execSync with a completely clean environment to avoid workspace detection
    return new Promise((resolve, reject) => {
      try {
  
        // Build the npm command - if we're using Homebrew npm with user prefix, it's still -g
        const npmCommand = `npm install -g ${packageName}`;

        // Send initial progress
        this.sendProgressToRenderer(tool, {
          percent: 10,
          status: 'Starting installation...',
          log: npmCommand
        });

        // Create a minimal environment that excludes npm workspace variables
        const cleanEnv = {
          PATH: this.getEnhancedPath(),
          HOME: process.env.HOME,
          USER: process.env.USER,
          SHELL: process.env.SHELL,
          TERM: process.env.TERM,
          // Explicitly exclude npm workspace-related environment variables
        };

        // Execute npm install with clean environment from user's home directory
        this.sendProgressToRenderer(tool, {
          percent: 30,
          status: 'Installing package globally...',
          log: 'This may take a few moments...'
        });

        const output = execSync(npmCommand, {
          encoding: 'utf8',
          cwd: os.homedir(), // Run from home directory
          env: cleanEnv, // Use minimal clean environment
          stdio: ['pipe', 'pipe', 'pipe'] // Capture all output
        });

        console.log('[CLIManager] Install output:', output);

        this.sendProgressToRenderer(tool, {
          percent: 70,
          status: 'Installation successful',
          log: output.trim()
        });

        // Verify installation
        this.sendProgressToRenderer(tool, {
          percent: 90,
          status: 'Verifying installation...',
          log: 'Checking installed version...'
        });

        this.checkInstallation(tool).then((status) => {
          if (status.installed) {
            this.sendProgressToRenderer(tool, {
              percent: 100,
              status: 'Installation complete!',
              log: `${tool} v${status.version} installed successfully`
            });
            resolve();
          } else {
            reject(new Error('Installation verification failed'));
          }
        }).catch(reject);

      } catch (error: any) {
        console.error('[CLIManager] Install error:', error);
        this.sendProgressToRenderer(tool, {
          percent: 0,
          status: 'Installation failed',
          log: error.message || 'Unknown error occurred'
        });
        reject(error);
      }
    });
  }

  async uninstall(tool: CLITool): Promise<void> {
    // First check if npm is available
    const npmCheck = await this.checkNpmAvailable();
    if (!npmCheck.available) {
      throw new Error(npmCheck.error || 'npm is not available');
    }

    const packageName = CLI_PACKAGES[tool];

    return new Promise((resolve, reject) => {
      try {
  
        // Build the npm command
        const npmCommand = `npm uninstall -g ${packageName}`;

        // Create a minimal environment that excludes npm workspace variables
        const cleanEnv = {
          PATH: this.getEnhancedPath(),
          HOME: process.env.HOME,
          USER: process.env.USER,
          SHELL: process.env.SHELL,
          TERM: process.env.TERM,
        };

        console.log(`[CLIManager] Uninstalling ${packageName}...`);
        console.log(`[CLIManager] Working directory: ${os.homedir()}`);
        console.log(`[CLIManager] Command: ${npmCommand}`);

        // Execute npm uninstall with clean environment from user's home directory
        // Use inherit for stderr to see errors immediately
        const output = execSync(npmCommand, {
          encoding: 'utf8',
          cwd: os.homedir(), // Run from home directory
          env: cleanEnv, // Use minimal clean environment
          stdio: ['pipe', 'pipe', 'inherit'] // Let stderr go to console
        });

        console.log('[CLIManager] Uninstall output:', output || '(no output)');

        // Check if package was actually removed
        if (output.includes('removed') || output.includes('uninstalled')) {
          console.log('[CLIManager] Package successfully uninstalled');
        } else if (output.includes('up to date')) {
          console.log('[CLIManager] Package was not installed or already removed');
        }

        resolve();

      } catch (error: any) {
        console.error('[CLIManager] Uninstall error:', error.message);
        if (error.stdout) {
          console.error('[CLIManager] Stdout:', error.stdout);
        }
        if (error.stderr) {
          console.error('[CLIManager] Stderr:', error.stderr);
        }
        reject(error);
      }
    });
  }

  private sendProgressToRenderer(tool: CLITool, progress: any) {
    // Send to all windows
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send(`cli-install-progress-${tool}`, progress);
    });
  }

  private async getLatestVersion(tool: CLITool): Promise<string | null> {
    const packageName = CLI_PACKAGES[tool];

    try {
      const { stdout } = await execAsync(`npm view ${packageName} version`);
      return stdout.trim();
    } catch (error) {
      console.error(`[CLIManager] Failed to get latest version for ${tool}:`, error);
      return null;
    }
  }

  private isNewerVersion(latest: string, current: string): boolean {
    try {
      const latestParts = latest.split('.').map(Number);
      const currentParts = current.split('.').map(Number);

      for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
        const latestPart = latestParts[i] || 0;
        const currentPart = currentParts[i] || 0;

        if (latestPart > currentPart) return true;
        if (latestPart < currentPart) return false;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  async upgrade(tool: CLITool): Promise<void> {
    // First check if npm is available
    const npmCheck = await this.checkNpmAvailable();
    if (!npmCheck.available) {
      throw new Error(npmCheck.error || 'npm is not available');
    }

    const packageName = CLI_PACKAGES[tool];

    return new Promise((resolve, reject) => {
      try {
  
        // Build the npm command - use install with @latest to ensure we get the latest version
        const npmCommand = `npm install -g ${packageName}@latest`;

        // Send progress updates
        this.sendProgressToRenderer(tool, {
          percent: 10,
          status: 'Checking for updates...',
          log: npmCommand
        });

        // Create a minimal environment that excludes npm workspace variables
        const cleanEnv = {
          PATH: this.getEnhancedPath(),
          HOME: process.env.HOME,
          USER: process.env.USER,
          SHELL: process.env.SHELL,
          TERM: process.env.TERM,
        };

        this.sendProgressToRenderer(tool, {
          percent: 30,
          status: 'Updating package...',
          log: 'This may take a few moments...'
        });

        // Execute npm install @latest with clean environment from user's home directory
        const output = execSync(npmCommand, {
          encoding: 'utf8',
          cwd: os.homedir(), // Run from home directory
          env: cleanEnv, // Use minimal clean environment
          stdio: ['pipe', 'pipe', 'pipe']
        });

        console.log('[CLIManager] Update output:', output);

        this.sendProgressToRenderer(tool, {
          percent: 100,
          status: 'Update complete!',
          log: `Successfully updated ${tool}`
        });

        resolve();

      } catch (error: any) {
        console.error('[CLIManager] Update error:', error);
        this.sendProgressToRenderer(tool, {
          percent: 0,
          status: 'Update failed',
          log: error.message || 'Unknown error occurred'
        });
        reject(error);
      }
    });
  }

  async installNodeJs(): Promise<void> {
    const platform = process.platform;

    return new Promise((resolve, reject) => {
      try {
  
        this.sendProgressToRenderer('nodejs' as CLITool, {
          percent: 10,
          status: 'Starting Node.js installation...',
          log: 'Detecting platform and package manager...'
        });

        if (platform === 'darwin') {
          // macOS - DO NOT use Homebrew for Node.js! It creates permission issues.
          // Direct users to download the official installer for user-local installation.

          this.sendProgressToRenderer('nodejs' as CLITool, {
            percent: 30,
            status: 'Opening Node.js download page...',
            log: 'Please download the macOS installer from nodejs.org'
          });

          // Check if user has Homebrew Node.js and warn them
          try {
            const whichNode = execSync('which node', { encoding: 'utf8' }).trim();
            if (whichNode.includes('/opt/homebrew') || whichNode.includes('/usr/local/Cellar')) {
              this.sendProgressToRenderer('nodejs' as CLITool, {
                percent: 0,
                status: 'Warning: Homebrew Node.js detected',
                log: '⚠️ You have Node.js installed via Homebrew which causes permission issues.\nPlease uninstall it with: brew uninstall node\nThen install from nodejs.org'
              });
            }
          } catch (e) {
            // Node not found, which is fine
          }

          shell.openExternal('https://nodejs.org/en/download/');

          reject(new Error('Please download and install Node.js from the opened webpage (NOT via Homebrew), then restart Nimbalyst.'));
        } else if (platform === 'win32') {
          // Windows - download the installer
          this.sendProgressToRenderer('nodejs' as CLITool, {
            percent: 30,
            status: 'Opening Node.js download page...',
            log: 'Please download and run the Windows installer'
          });

          shell.openExternal('https://nodejs.org/en/download/');

          reject(new Error('Please download and install Node.js from the opened webpage, then restart Nimbalyst.'));
        } else if (platform === 'linux') {
          // Linux - try package managers
          this.sendProgressToRenderer('nodejs' as CLITool, {
            percent: 30,
            status: 'Installing Node.js via package manager...',
            log: 'Attempting installation...'
          });

          // Try different package managers
          const packageManagers = [
            { cmd: 'apt-get', install: 'sudo apt-get update && sudo apt-get install -y nodejs npm' },
            { cmd: 'yum', install: 'sudo yum install -y nodejs npm' },
            { cmd: 'dnf', install: 'sudo dnf install -y nodejs npm' },
            { cmd: 'pacman', install: 'sudo pacman -S --noconfirm nodejs npm' },
            { cmd: 'snap', install: 'sudo snap install node --classic' }
          ];

          let installed = false;
          for (const pm of packageManagers) {
            try {
              execSync(`which ${pm.cmd}`, { encoding: 'utf8' });

              this.sendProgressToRenderer('nodejs' as CLITool, {
                percent: 50,
                status: `Found ${pm.cmd}, installing Node.js...`,
                log: pm.install
              });

              execSync(pm.install, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
              });

              installed = true;
              break;
            } catch (e) {
              // Try next package manager
            }
          }

          if (!installed) {
              shell.openExternal('https://nodejs.org/en/download/');
            reject(new Error('Could not install Node.js automatically. Please install from the opened webpage.'));
            return;
          }

          this.sendProgressToRenderer('nodejs' as CLITool, {
            percent: 100,
            status: 'Node.js installed successfully!',
            log: 'Installation complete'
          });

          // Clear the cached npm availability
          this.npmAvailable = null;
          resolve();
        } else {
          reject(new Error(`Unsupported platform: ${platform}`));
        }
      } catch (error: any) {
        console.error('[CLIManager] Node.js install error:', error);
        this.sendProgressToRenderer('nodejs' as CLITool, {
          percent: 0,
          status: 'Installation failed',
          log: error.message || 'Unknown error occurred'
        });
        reject(error);
      }
    });
  }

  private getEnhancedPath(): string {
    return getEnhancedPath();
  }

  // Clean up on app quit
  cleanup() {
    this.installingTools.forEach((process, tool) => {
      console.log(`[CLIManager] Killing installation process for ${tool}`);
      process.kill();
    });
    this.installingTools.clear();
  }
}

/**
 * Get an enhanced PATH that includes common CLI installation locations.
 * This is needed because GUI apps on macOS don't inherit the shell's PATH
 * when launched from Finder/dock, so commands like npx, node, uvx etc.
 * installed via Homebrew, nvm, or other tools won't be found.
 *
 * Used by:
 * - CLIManager for CLI tool installation/detection
 * - MCPConfigService for spawning MCP servers
 */
export function getEnhancedPath(): string {
  // Add common npm global paths to PATH
  const paths: string[] = [];

  // Start with existing PATH
  if (process.env.PATH) {
    paths.push(process.env.PATH);
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    // Common Unix paths
    paths.push('/usr/local/bin');
    paths.push('/usr/bin');
    paths.push('/bin');
    paths.push(path.join(os.homedir(), '.npm-global', 'bin'));
    paths.push(path.join(os.homedir(), '.local', 'bin'));
    paths.push(path.join(os.homedir(), 'bin'));

    // Add Homebrew paths for macOS
    if (process.platform === 'darwin') {
      paths.push('/opt/homebrew/bin');
      paths.push('/opt/homebrew/sbin');
      paths.push('/usr/local/opt/node/bin');
      paths.push('/usr/local/opt/node@20/bin');
      paths.push('/usr/local/opt/node@18/bin');
      // MacPorts
      paths.push('/opt/local/bin');
      paths.push('/opt/local/sbin');
    }

    // Linux specific
    if (process.platform === 'linux') {
      paths.push('/usr/local/sbin');
      paths.push('/usr/sbin');
      paths.push('/sbin');
      // Snap packages
      paths.push('/snap/bin');
    }

    // NVM paths
    const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
    try {
      // Try to find current NVM node
      const nvmCurrent = path.join(nvmDir, 'current', 'bin');
      paths.push(nvmCurrent);
    } catch (e) {
      // Ignore
    }

    // Try to get npm prefix if npm exists somewhere
    try {
      const npmPrefix = execSync('npm config get prefix 2>/dev/null', {
        encoding: 'utf8',
        shell: '/bin/sh',
        timeout: 2000
      }).trim();
      if (npmPrefix && npmPrefix !== 'undefined') {
        paths.push(path.join(npmPrefix, 'bin'));
      }
    } catch (e) {
      // Ignore if npm is not available
    }
  } else if (process.platform === 'win32') {
    // On Windows, GUI apps don't inherit the full user PATH from shell sessions.
    // Query the actual user PATH from the registry to get the complete PATH.
    try {
      const { execSync } = require('child_process');
      // Get User PATH from registry
      const userPathResult = execSync(
        'reg query "HKCU\\Environment" /v Path',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      );
      const userPathMatch = userPathResult.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
      if (userPathMatch && userPathMatch[1]) {
        paths.push(userPathMatch[1].trim());
      }
    } catch (e) {
      // Registry query failed, fall back to common paths
    }

    // Also add common paths as fallback (in case registry query misses something)
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    paths.push(path.join(programFiles, 'nodejs'));
    paths.push(path.join(programFilesX86, 'nodejs'));
    paths.push(path.join(process.env.APPDATA || '', 'npm'));
    paths.push('C:\\ProgramData\\chocolatey\\bin');
    paths.push('C:\\tools\\nodejs');

    // User profile paths
    const userProfile = process.env.USERPROFILE || process.env.HOME;
    if (userProfile) {
      paths.push(path.join(userProfile, 'AppData', 'Roaming', 'npm'));
      paths.push(path.join(userProfile, 'scoop', 'shims'));
      // uv/uvx default installation path
      paths.push(path.join(userProfile, '.local', 'bin'));
      // Bun default installation path
      paths.push(path.join(userProfile, '.bun', 'bin'));
      // Deno default installation path
      paths.push(path.join(userProfile, '.deno', 'bin'));
    }

    // NVM for Windows
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    }
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) {
      paths.push(nvmSymlink);
    }
  }

  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const pathString = uniquePaths.join(process.platform === 'win32' ? ';' : ':');

  return pathString;
}

// Export singleton
export const cliManager = new CLIManager();
