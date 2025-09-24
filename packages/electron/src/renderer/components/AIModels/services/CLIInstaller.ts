// CLI Installer service for managing npm package installations
// Uses IPC to communicate with the main process for actual npm operations

interface InstallProgress {
  percent: number;
  status: string;
  log?: string;
}

interface InstallOptions {
  onProgress?: (progress: InstallProgress) => void;
  localInstall?: boolean;
}

interface InstallationStatus {
  installed: boolean;
  version?: string;
  updateAvailable?: boolean;
  path?: string;
}

type CLITool = 'claude-code' | 'openai-codex';

export class CLIInstaller {
  private installingTools = new Set<CLITool>();

  /**
   * Check if npm is available on the system
   */
  async checkNpmAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const result = await window.electronAPI.cliCheckNpmAvailable();
      return result;
    } catch (error) {
      console.error('Failed to check npm availability:', error);
      return {
        available: false,
        error: 'Failed to check npm availability'
      };
    }
  }

  /**
   * Install Node.js and npm on the system
   */
  async installNodeJs(options: InstallOptions = {}): Promise<void> {
    try {
      // Set up progress listener
      const progressListener = (event: any, progress: InstallProgress) => {
        options.onProgress?.(progress);
      };

      // Listen for progress updates
      window.electronAPI.on('cli-install-progress-nodejs', progressListener);

      try {
        await window.electronAPI.cliInstallNodeJs();

        options.onProgress?.({
          percent: 100,
          status: 'Node.js installation complete!',
          log: 'Please restart Preditor to use Node.js'
        });
      } finally {
        // Clean up listener
        window.electronAPI.off('cli-install-progress-nodejs', progressListener);
      }
    } catch (error: any) {
      console.error('Failed to install Node.js:', error);
      throw error;
    }
  }

  /**
   * Check if a CLI tool is installed and get its version
   */
  async checkInstallation(tool: CLITool): Promise<InstallationStatus> {
    try {
      const result = await window.electronAPI.cliCheckInstallation(tool);
      return result;
    } catch (error) {
      console.error(`Failed to check ${tool} installation:`, error);
      return { installed: false };
    }
  }

  /**
   * Install a CLI tool
   */
  async install(tool: CLITool, options: InstallOptions = {}): Promise<void> {
    if (this.installingTools.has(tool)) {
      throw new Error(`${tool} is already being installed`);
    }

    this.installingTools.add(tool);

    try {
      // Set up progress listener
      const progressListener = (event: any, progress: InstallProgress) => {
        options.onProgress?.(progress);
      };

      // Listen for progress updates
      window.electronAPI.on(`cli-install-progress-${tool}`, progressListener);

      try {
        // Start installation
        await window.electronAPI.cliInstall(tool, {
          localInstall: options.localInstall
        });

        options.onProgress?.({
          percent: 100,
          status: 'Installation complete!',
          log: 'Successfully installed'
        });
      } finally {
        // Clean up listener
        window.electronAPI.off(`cli-install-progress-${tool}`, progressListener);
      }
    } finally {
      this.installingTools.delete(tool);
    }
  }

  /**
   * Uninstall a CLI tool
   */
  async uninstall(tool: CLITool): Promise<void> {
    try {
      await window.electronAPI.cliUninstall(tool);
    } catch (error) {
      console.error(`Failed to uninstall ${tool}:`, error);
      throw error;
    }
  }

  /**
   * Update a CLI tool to the latest version
   */
  async update(tool: CLITool, options: InstallOptions = {}): Promise<void> {
    // Set up progress listener
    const progressListener = (event: any, progress: InstallProgress) => {
      options.onProgress?.(progress);
    };

    // Listen for progress updates
    window.electronAPI.on(`cli-install-progress-${tool}`, progressListener);

    try {
      // Start upgrade
      await window.electronAPI.cliUpgrade(tool);

      options.onProgress?.({
        percent: 100,
        status: 'Update complete!',
        log: 'Successfully updated'
      });
    } finally {
      // Clean up listener
      window.electronAPI.off(`cli-install-progress-${tool}`, progressListener);
    }
  }
}