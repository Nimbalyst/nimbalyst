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

const NIMBALYST_LOCAL_DIR = 'nimbalyst-local';

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
   * Get installed packages by checking file existence on disk
   * Does NOT use persisted state - always calculates fresh
   */
  async getInstalledPackages(): Promise<InstalledPackage[]> {
    if (!this.workspacePath) {
      throw new Error('Workspace path not set');
    }

    const installed: InstalledPackage[] = [];

    // Check each package to see if its files exist
    for (const pkg of ALL_PACKAGES) {
      const isInstalled = await this.isPackageInstalled(pkg.id);
      if (isInstalled) {
        installed.push({
          packageId: pkg.id,
          installedAt: new Date().toISOString(), // Placeholder - not persisted
          enabled: true,
        });
      }
    }

    return installed;
  }

  /**
   * Check if a package is installed
   *
   * Checks actual file existence on disk - does NOT use or update persisted state.
   * A package is considered installed if ALL of its files exist on disk:
   * - ALL custom command files must exist
   * - ALL tracker schema files must exist
   */
  async isPackageInstalled(packageId: string): Promise<boolean> {
    const pkg = getPackageById(packageId);
    if (!pkg) {
      return false;
    }

    // Check that ALL custom commands exist
    for (const command of pkg.customCommands) {
      const exists = await this.checkCommandExists(command.name, pkg.settings?.commandsLocation || 'project');
      if (!exists) {
        return false;
      }
    }

    // Check that ALL tracker schemas exist
    for (const schema of pkg.trackerSchemas) {
      const exists = await this.checkTrackerSchemaExists(schema.type);
      if (!exists) {
        return false;
      }
    }

    // All files exist
    const hasAnyFiles = pkg.customCommands.length > 0 || pkg.trackerSchemas.length > 0;
    return hasAnyFiles;
  }


  /**
   * Check if a command file exists on disk
   */
  private async checkCommandExists(commandName: string, location: 'project' | 'global'): Promise<boolean> {
    try {
      if (location === 'global') {
        const result = await window.electronAPI.invoke('read-global-claude-file', `commands/${commandName}.md`);
        return !!result?.content;
      } else {
        const fullPath = `${this.workspacePath}/.claude/commands/${commandName}.md`;
        const result = await window.electronAPI.readFileContent(fullPath);
        return !!result?.content;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a tracker schema file exists on disk
   */
  private async checkTrackerSchemaExists(type: string): Promise<boolean> {
    try {
      const fullPath = `${this.workspacePath}/.nimbalyst/trackers/${type}.yaml`;
      const result = await window.electronAPI.readFileContent(fullPath);
      return !!result?.content;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a package uses the nimbalyst-local directory
   */
  private packageUsesNimbalystLocal(pkg: ToolPackage): boolean {
    // Check if any command content references nimbalyst-local
    for (const command of pkg.customCommands) {
      if (command.content.includes(NIMBALYST_LOCAL_DIR)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if the nimbalyst-local directory exists
   */
  private async nimbalystLocalExists(): Promise<boolean> {
    try {
      const result = await window.electronAPI.invoke('file:exists', `${this.workspacePath}/${NIMBALYST_LOCAL_DIR}`);
      return !!result;
    } catch (error) {
      console.log(`[PackageService] Could not check if ${NIMBALYST_LOCAL_DIR} exists:`, error);
      return false;
    }
  }

  /**
   * Check if nimbalyst-local is already in .gitignore
   */
  private async isInGitignore(): Promise<boolean> {
    try {
      const gitignorePath = `${this.workspacePath}/.gitignore`;
      const result = await window.electronAPI.readFileContent(gitignorePath);
      if (result && result.content) {
        // Check if nimbalyst-local/ is already ignored
        return result.content.includes(`${NIMBALYST_LOCAL_DIR}/`);
      }
      return false;
    } catch (error) {
      // .gitignore doesn't exist
      return false;
    }
  }

  /**
   * Add nimbalyst-local to .gitignore if not already present
   */
  private async addToGitignore(): Promise<void> {
    try {
      const gitignorePath = `${this.workspacePath}/.gitignore`;
      const ignoreEntry = `\n# Nimbalyst local data (not checked into version control)\n${NIMBALYST_LOCAL_DIR}/\n`;

      let content = '';
      try {
        const result = await window.electronAPI.readFileContent(gitignorePath);
        if (result && result.content) {
          content = result.content;
        }
      } catch (err) {
        // File doesn't exist, will create it
      }

      // Double-check it's not already there
      if (content.includes(`${NIMBALYST_LOCAL_DIR}/`)) {
        console.log(`[PackageService] ${NIMBALYST_LOCAL_DIR}/ already in .gitignore`);
        return;
      }

      // Append the ignore entry
      const finalContent = content + ignoreEntry;
      await window.electronAPI.invoke('create-document', '.gitignore', finalContent);
      console.log(`[PackageService] Added ${NIMBALYST_LOCAL_DIR}/ to .gitignore`);
    } catch (error) {
      console.error(`[PackageService] Failed to update .gitignore:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Create the nimbalyst-local directory
   */
  private async createNimbalystLocalDir(): Promise<void> {
    try {
      // Create a .gitkeep file to ensure the directory exists
      await window.electronAPI.invoke('create-document', `${NIMBALYST_LOCAL_DIR}/.gitkeep`, '');
      console.log(`[PackageService] Created ${NIMBALYST_LOCAL_DIR} directory`);
    } catch (error) {
      console.error(`[PackageService] Failed to create ${NIMBALYST_LOCAL_DIR} directory:`, error);
      throw error;
    }
  }

  /**
   * Ensure nimbalyst-local directory exists and is in .gitignore (if first time creation)
   */
  private async ensureNimbalystLocalDir(): Promise<void> {
    const dirExists = await this.nimbalystLocalExists();
    const alreadyIgnored = await this.isInGitignore();

    if (!dirExists) {
      // First time creation - create directory and add to .gitignore
      await this.createNimbalystLocalDir();

      if (!alreadyIgnored) {
        await this.addToGitignore();
      }
    }
    // If directory already exists, don't touch .gitignore
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

      // Check if this package uses nimbalyst-local and ensure directory exists
      if (this.packageUsesNimbalystLocal(pkg)) {
        await this.ensureNimbalystLocalDir();
      }

      // Install custom commands
      for (const command of pkg.customCommands) {
        await this.installCommand(command, pkg.settings?.commandsLocation || 'project');
      }

      // Install tracker schemas
      for (const schema of pkg.trackerSchemas) {
        await this.installTrackerSchema(schema);
      }

      // No state persistence - installation status is determined by file existence
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

      // No state persistence - installation status is determined by file existence
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
   * Verifies actual file existence for each package (not just state)
   */
  async getAllPackagesWithStatus(): Promise<Array<{ package: ToolPackage; installed: boolean }>> {
    const packages = this.getAvailablePackages();
    const statuses = await Promise.all(
      packages.map(async pkg => {
        const installed = await this.isPackageInstalled(pkg.id);
        return {
          package: pkg,
          installed,
        };
      })
    );

    return statuses;
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
