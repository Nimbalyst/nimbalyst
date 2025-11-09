/**
 * Package Management Service
 *
 * Handles installation, uninstallation, and management of tool packages
 */

import {
  ToolPackage,
  InstalledPackage,
  PackageRegistry,
  CustomCommand,
  TrackerSchema,
} from '../../shared/toolPackages';
import { ALL_PACKAGES, getPackageById } from '../../shared/toolPackages';

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): Record<string, any> | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const yamlContent = match[1];
  const result: Record<string, any> = {};

  // Simple YAML parser for our use case (key: value pairs)
  const lines = yamlContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Version comparison result
 */
interface VersionStatus {
  isInstalled: boolean;
  installedVersion?: string;
  latestVersion: string;
  needsUpdate: boolean;
}

export class PackageService {
  private static instance: PackageService;
  private workspacePath: string = '';

  private constructor() {}

  static getInstance(): PackageService {
    if (!PackageService.instance) {
      PackageService.instance = new PackageService();
    }
    return PackageService.instance;
  }

  /**
   * Set the current workspace path
   */
  setWorkspacePath(path: string): void {
    this.workspacePath = path;
  }

  /**
   * Get all available packages
   */
  getAvailablePackages(): ToolPackage[] {
    return ALL_PACKAGES;
  }

  /**
   * Get installed packages from workspace state
   */
  async getInstalledPackages(): Promise<InstalledPackage[]> {
    if (!this.workspacePath) {
      throw new Error('Workspace path not set');
    }

    try {
      const state = await window.electronAPI.invoke('workspace:get-state', this.workspacePath);
      return state?.installedPackages || [];
    } catch (error) {
      console.error('Failed to get installed packages:', error);
      return [];
    }
  }

  /**
   * Check if a package is installed
   */
  async isPackageInstalled(packageId: string): Promise<boolean> {
    const installed = await this.getInstalledPackages();
    return installed.some(pkg => pkg.packageId === packageId && pkg.enabled);
  }

  /**
   * Install a package
   */
  async installPackage(packageId: string): Promise<void> {
    if (!this.workspacePath) {
      throw new Error('Workspace path not set');
    }

    const pkg = getPackageById(packageId);
    if (!pkg) {
      throw new Error(`Package not found: ${packageId}`);
    }

    console.log(`[PackageService] Installing package: ${pkg.name}`);

    try {
      // Install dependencies first
      if (pkg.dependencies && pkg.dependencies.length > 0) {
        console.log(`[PackageService] Installing dependencies for ${pkg.name}:`, pkg.dependencies);
        for (const depId of pkg.dependencies) {
          const isDepInstalled = await this.isPackageInstalled(depId);
          if (!isDepInstalled) {
            console.log(`[PackageService] Installing dependency: ${depId}`);
            await this.installPackage(depId); // Recursive install
          } else {
            console.log(`[PackageService] Dependency ${depId} already installed`);
          }
        }
      }

      // Install custom commands
      for (const command of pkg.customCommands) {
        await this.installCommand(command, pkg.settings?.commandsLocation || 'project');
      }

      // Install tracker schemas
      for (const schema of pkg.trackerSchemas) {
        await this.installTrackerSchema(schema);
      }

      // Update installed packages list
      const installed = await this.getInstalledPackages();
      const existingIndex = installed.findIndex(p => p.packageId === packageId);

      const newInstalledPackage: InstalledPackage = {
        packageId,
        installedAt: new Date().toISOString(),
        enabled: true,
      };

      if (existingIndex >= 0) {
        installed[existingIndex] = newInstalledPackage;
      } else {
        installed.push(newInstalledPackage);
      }

      await window.electronAPI.invoke('workspace:update-state', this.workspacePath, {
        installedPackages: installed,
      });

      console.log(`[PackageService] Successfully installed package: ${pkg.name}`);
    } catch (error) {
      console.error(`[PackageService] Failed to install package ${pkg.name}:`, error);
      throw error;
    }
  }

  /**
   * Uninstall a package
   */
  async uninstallPackage(packageId: string): Promise<void> {
    if (!this.workspacePath) {
      throw new Error('Workspace path not set');
    }

    const pkg = getPackageById(packageId);
    if (!pkg) {
      throw new Error(`Package not found: ${packageId}`);
    }

    console.log(`[PackageService] Uninstalling package: ${pkg.name}`);

    try {
      // Remove custom commands
      for (const command of pkg.customCommands) {
        await this.removeCommand(command, pkg.settings?.commandsLocation || 'project');
      }

      // Remove tracker schemas
      for (const schema of pkg.trackerSchemas) {
        await this.removeTrackerSchema(schema);
      }

      // Update installed packages list
      const installed = await this.getInstalledPackages();
      const filtered = installed.filter(p => p.packageId !== packageId);

      await window.electronAPI.invoke('workspace:update-state', this.workspacePath, {
        installedPackages: filtered,
      });

      console.log(`[PackageService] Successfully uninstalled package: ${pkg.name}`);
    } catch (error) {
      console.error(`[PackageService] Failed to uninstall package ${pkg.name}:`, error);
      throw error;
    }
  }

  /**
   * Install a custom command
   */
  private async installCommand(command: CustomCommand, location: 'project' | 'global'): Promise<void> {
    const relativePath = `commands/${command.name}.md`;

    try {
      if (location === 'global') {
        await window.electronAPI.invoke('write-global-claude-file', relativePath, command.content);
      } else {
        await window.electronAPI.invoke('create-document', `.claude/${relativePath}`, command.content);
      }
      console.log(`[PackageService] Installed command: ${command.name}`);
    } catch (error) {
      console.error(`[PackageService] Failed to install command ${command.name}:`, error);
      throw error;
    }
  }

  /**
   * Remove a custom command
   */
  private async removeCommand(command: CustomCommand, location: 'project' | 'global'): Promise<void> {
    const relativePath = `commands/${command.name}.md`;

    try {
      if (location === 'global') {
        // Use read-global-claude-file to check existence, then delete
        await window.electronAPI.invoke('delete-global-claude-file', relativePath);
      } else {
        const fullPath = `${this.workspacePath}/.claude/${relativePath}`;
        await window.electronAPI.invoke('delete-file', fullPath);
      }
      console.log(`[PackageService] Removed command: ${command.name}`);
    } catch (error) {
      // Command might not exist, which is fine
      console.log(`[PackageService] Command ${command.name} not found (may have been removed already)`);
    }
  }

  /**
   * Install a tracker schema
   */
  private async installTrackerSchema(schema: TrackerSchema): Promise<void> {
    const relativePath = `.nimbalyst/trackers/${schema.type}.yaml`;

    try {
      await window.electronAPI.invoke('create-document', relativePath, schema.yamlContent);
      console.log(`[PackageService] Installed tracker schema: ${schema.type}`);
    } catch (error) {
      console.error(`[PackageService] Failed to install tracker schema ${schema.type}:`, error);
      throw error;
    }
  }

  /**
   * Remove a tracker schema
   */
  private async removeTrackerSchema(schema: TrackerSchema): Promise<void> {
    const fullPath = `${this.workspacePath}/.nimbalyst/trackers/${schema.type}.yaml`;

    try {
      await window.electronAPI.invoke('delete-file', fullPath);
      console.log(`[PackageService] Removed tracker schema: ${schema.type}`);
    } catch (error) {
      // Schema might not exist, which is fine
      console.log(`[PackageService] Tracker schema ${schema.type} not found (may have been removed already)`);
    }
  }

  /**
   * Get package details with installation status
   */
  async getPackageWithStatus(packageId: string): Promise<{ package: ToolPackage; installed: boolean } | null> {
    const pkg = getPackageById(packageId);
    if (!pkg) {
      return null;
    }

    const installed = await this.isPackageInstalled(packageId);
    return { package: pkg, installed };
  }

  /**
   * Get all packages with installation status
   */
  async getAllPackagesWithStatus(): Promise<Array<{ package: ToolPackage; installed: boolean }>> {
    const packages = this.getAvailablePackages();
    const installedPackages = await this.getInstalledPackages();
    const installedIds = new Set(installedPackages.filter(p => p.enabled).map(p => p.packageId));

    return packages.map(pkg => ({
      package: pkg,
      installed: installedIds.has(pkg.id),
    }));
  }

  /**
   * Get version status for a package
   */
  async getPackageVersionStatus(packageId: string): Promise<VersionStatus | null> {
    const pkg = getPackageById(packageId);
    if (!pkg) {
      return null;
    }

    const installed = await this.isPackageInstalled(packageId);
    if (!installed) {
      return {
        isInstalled: false,
        latestVersion: pkg.version,
        needsUpdate: false,
      };
    }

    // Check version from one of the installed commands
    if (pkg.customCommands.length > 0) {
      const command = pkg.customCommands[0];
      const installedVersion = await this.getInstalledCommandVersion(command.name, pkg.settings?.commandsLocation || 'project');

      if (installedVersion) {
        return {
          isInstalled: true,
          installedVersion,
          latestVersion: pkg.version,
          needsUpdate: this.compareVersions(installedVersion, pkg.version) < 0,
        };
      }
    }

    // Check version from one of the installed tracker schemas
    if (pkg.trackerSchemas.length > 0) {
      const schema = pkg.trackerSchemas[0];
      const installedVersion = await this.getInstalledTrackerVersion(schema.type);

      if (installedVersion) {
        return {
          isInstalled: true,
          installedVersion,
          latestVersion: pkg.version,
          needsUpdate: this.compareVersions(installedVersion, pkg.version) < 0,
        };
      }
    }

    // Installed but can't determine version
    return {
      isInstalled: true,
      latestVersion: pkg.version,
      needsUpdate: false,
    };
  }

  /**
   * Get installed version of a command
   */
  private async getInstalledCommandVersion(commandName: string, location: 'project' | 'global'): Promise<string | null> {
    try {
      let content: string | null = null;

      if (location === 'global') {
        const result = await window.electronAPI.invoke('read-global-claude-file', `commands/${commandName}.md`);
        content = result?.content;
      } else {
        const fullPath = `${this.workspacePath}/.claude/commands/${commandName}.md`;
        const result = await window.electronAPI.readFileContent(fullPath);
        content = result?.content;
      }

      if (!content) {
        return null;
      }

      const frontmatter = parseFrontmatter(content);
      return frontmatter?.packageVersion || null;
    } catch (error) {
      console.log(`Could not read version for command ${commandName}:`, error);
      return null;
    }
  }

  /**
   * Get installed version of a tracker schema
   */
  private async getInstalledTrackerVersion(type: string): Promise<string | null> {
    try {
      const fullPath = `${this.workspacePath}/.nimbalyst/trackers/${type}.yaml`;
      const result = await window.electronAPI.readFileContent(fullPath);

      if (!result?.content) {
        return null;
      }

      const frontmatter = parseFrontmatter(result.content);
      return frontmatter?.packageVersion || null;
    } catch (error) {
      console.log(`Could not read version for tracker ${type}:`, error);
      return null;
    }
  }

  /**
   * Compare two semantic versions
   * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }

    return 0;
  }

  /**
   * Get all packages with installation status and version information
   */
  async getAllPackagesWithVersionStatus(): Promise<Array<{ package: ToolPackage; versionStatus: VersionStatus }>> {
    const packages = this.getAvailablePackages();
    const statuses = await Promise.all(
      packages.map(async pkg => {
        const versionStatus = await this.getPackageVersionStatus(pkg.id);
        return {
          package: pkg,
          versionStatus: versionStatus || {
            isInstalled: false,
            latestVersion: pkg.version,
            needsUpdate: false,
          },
        };
      })
    );

    return statuses;
  }
}

export default PackageService.getInstance();
