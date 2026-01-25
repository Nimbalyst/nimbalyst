import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import PackageService from '../../services/PackageService';
import { ToolPackage } from '../../../shared/toolPackages';

export interface SettingsScreenProps {
  workspacePath: string;
  workspaceName: string;
  onClose: () => void;
  isFirstTime?: boolean;
}

interface VersionStatus {
  isInstalled: boolean;
  installedVersion?: string;
  latestVersion: string;
  needsUpdate: boolean;
}

interface PackageWithStatus {
  package: ToolPackage;
  versionStatus: VersionStatus;
}

const ProjectSettingsScreen: React.FC<SettingsScreenProps> = ({
  workspacePath,
  workspaceName,
  onClose,
  isFirstTime = false,
}) => {
  const posthog = usePostHog();
  const [packages, setPackages] = useState<PackageWithStatus[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedPackageId, setExpandedPackageId] = useState<string | null>(null);

  // Load packages on mount
  useEffect(() => {
    const loadPackages = async () => {
      PackageService.setWorkspacePath(workspacePath);
      const packagesWithStatus = await PackageService.getAllPackagesWithVersionStatus();
      setPackages(packagesWithStatus);
    };

    loadPackages();
  }, [workspacePath]);

  // Track screen open event
  useEffect(() => {
    if (packages.length > 0) {
      const installedCount = packages.filter(p => p.versionStatus.isInstalled).length;

      posthog?.capture('project_settings_opened', {
        isFirstTime,
        totalPackages: packages.length,
        installedPackages: installedCount,
      });
    }
  }, [packages, isFirstTime, posthog]);

  const handleInstallPackage = async (packageId: string) => {
    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      await PackageService.installPackage(packageId);

      // Refresh packages list with version info
      const updatedPackages = await PackageService.getAllPackagesWithVersionStatus();
      setPackages(updatedPackages);

      const pkg = packages.find(p => p.package.id === packageId);
      setSuccess(`${pkg?.package.name} package installed successfully!`);

      // Track installation
      posthog?.capture('package_installed', {
        packageId,
        packageName: pkg?.package.name,
      });

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(`Failed to install package ${packageId}:`, err);
      setError(err instanceof Error ? err.message : `Failed to install package`);

      // Track failure
      posthog?.capture('package_install_failed', {
        packageId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUninstallPackage = async (packageId: string) => {
    setError(null);
    setSuccess(null);
    setIsProcessing(true);

    try {
      await PackageService.uninstallPackage(packageId);

      // Refresh packages list with version info
      const updatedPackages = await PackageService.getAllPackagesWithVersionStatus();
      setPackages(updatedPackages);

      const pkg = packages.find(p => p.package.id === packageId);
      setSuccess(`${pkg?.package.name} package uninstalled successfully!`);

      // Track uninstallation
      posthog?.capture('package_uninstalled', {
        packageId,
        packageName: pkg?.package.name,
      });

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(`Failed to uninstall package ${packageId}:`, err);
      setError(err instanceof Error ? err.message : `Failed to uninstall package`);

      // Track failure
      posthog?.capture('package_uninstall_failed', {
        packageId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const togglePackageDetails = (packageId: string) => {
    setExpandedPackageId(expandedPackageId === packageId ? null : packageId);
  };

  const installedCount = packages.filter(p => p.versionStatus.isInstalled).length;
  const needsUpdateCount = packages.filter(p => p.versionStatus.needsUpdate).length;
  const totalCount = packages.length;

  return (
    <div className="settings-screen flex flex-col h-full overflow-hidden bg-[var(--nim-bg)]">
      <div className="settings-header flex justify-between items-center px-8 py-5 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
        <h2 className="m-0 text-2xl font-semibold text-[var(--nim-text)] flex items-center gap-3">
          <span className="material-symbols-outlined text-[28px] text-[var(--nim-primary)]">extension</span>
          Tool Packages for {workspaceName}
        </h2>
        <div className="settings-header-actions flex items-center gap-3">
          <button
            className="button-get-started nim-btn-primary py-2 px-4 rounded-md text-[13px] font-medium"
            onClick={onClose}
          >
            Get Started
          </button>
          <button
            className="settings-close nim-btn-ghost p-2 rounded-md flex items-center justify-center"
            onClick={onClose}
            title="Close settings"
          >
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>
      </div>

      <div className="settings-content nim-scrollbar flex-1 overflow-y-auto p-8">
        {error && (
          <div className="settings-message error flex items-center gap-3 py-3 px-4 rounded-lg mb-6 bg-[#fee] border border-[#fcc] text-[#c33]">
            <span className="material-symbols-outlined text-xl shrink-0">error</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="settings-message success flex items-center gap-3 py-3 px-4 rounded-lg mb-6 bg-[#efe] border border-[#cfc] text-[#3c3]">
            <span className="material-symbols-outlined text-xl shrink-0">check_circle</span>
            <span>{success}</span>
          </div>
        )}

        <div className="settings-intro mb-8">
          <p className="m-0 mb-4 text-[15px] text-[var(--nim-text-muted)] leading-relaxed">
            Tool packages bundle custom commands and tracker schemas into curated sets for different
            workflows. Each package includes everything you need to get started quickly.
          </p>
        </div>

        {totalCount > 0 && (
          <div className="settings-progress flex justify-between items-center py-4 px-5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg">
            <span className="progress-text text-sm font-medium text-[var(--nim-text)]">
              {installedCount} of {totalCount} packages installed
              {needsUpdateCount > 0 && ` • ${needsUpdateCount} update${needsUpdateCount > 1 ? 's' : ''} available`}
            </span>
          </div>
        )}

        <div className="settings-section mb-8">
          <h3 className="m-0 mb-4 text-lg font-semibold text-[var(--nim-text)]">Available Packages</h3>

          <div className="action-cards flex flex-col gap-3">
            {packages.map(({ package: pkg, versionStatus }) => (
              <div
                key={pkg.id}
                className={`action-card flex justify-between items-center py-4 px-5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg transition-all duration-200 hover:border-[var(--nim-primary)] hover:shadow-md ${versionStatus.isInstalled ? 'completed opacity-90 bg-[var(--nim-bg-tertiary)]' : ''}`}
              >
                <div className="action-info flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="material-symbols-outlined text-2xl text-[var(--nim-primary)]">
                      {pkg.icon}
                    </span>
                    <h4 className="m-0 text-[15px] font-semibold text-[var(--nim-text)]">{pkg.name}</h4>
                    {versionStatus.isInstalled && versionStatus.installedVersion && (
                      <span className="text-xs text-[var(--nim-text-faint)] ml-auto">
                        v{versionStatus.installedVersion}
                      </span>
                    )}
                  </div>
                  <p className="m-0 text-[13px] text-[var(--nim-text-muted)] leading-snug">{pkg.description}</p>

                  {expandedPackageId === pkg.id && (
                    <div className="mt-4 pt-4 border-t border-[var(--nim-border)]">
                      <div className="mb-3">
                        <strong className="text-[13px] text-[var(--nim-text)]">
                          Custom Commands ({pkg.customCommands.length})
                        </strong>
                        <ul className="mt-2 mb-0 pl-5 text-[13px] text-[var(--nim-text-muted)]">
                          {pkg.customCommands.map(cmd => (
                            <li key={cmd.name} className="mb-1">
                              <code className="bg-[var(--nim-bg-tertiary)] py-0.5 px-1.5 rounded">
                                /{cmd.name}
                              </code>
                              {' - '}
                              {cmd.description}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <strong className="text-[13px] text-[var(--nim-text)]">
                          Tracker Schemas ({pkg.trackerSchemas.length})
                        </strong>
                        <ul className="mt-2 mb-0 pl-5 text-[13px] text-[var(--nim-text-muted)]">
                          {pkg.trackerSchemas.map(schema => (
                            <li key={schema.type} className="mb-1">
                              <span className="material-symbols-outlined text-sm align-middle mr-1">
                                {schema.icon}
                              </span>
                              {schema.displayName}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => togglePackageDetails(pkg.id)}
                    className="mt-3 py-1 px-2 bg-transparent border-none text-[var(--nim-primary)] text-[13px] cursor-pointer flex items-center gap-1"
                  >
                    {expandedPackageId === pkg.id ? 'Hide' : 'Show'} details
                    <span className="material-symbols-outlined text-base">
                      {expandedPackageId === pkg.id ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>
                </div>

                {!versionStatus.isInstalled ? (
                  <button
                    className="action-install-button nim-btn-primary py-1.5 px-4 rounded-md text-[13px] font-medium whitespace-nowrap"
                    onClick={() => handleInstallPackage(pkg.id)}
                    disabled={isProcessing}
                  >
                    Install
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 items-end">
                    {versionStatus.needsUpdate ? (
                      <>
                        <button
                          className="action-install-button nim-btn-primary py-1.5 px-4 rounded-md text-[13px] font-medium flex items-center gap-1"
                          onClick={() => handleInstallPackage(pkg.id)}
                          disabled={isProcessing}
                        >
                          <span className="material-symbols-outlined text-base">
                            upgrade
                          </span>
                          Update to v{versionStatus.latestVersion}
                        </button>
                        <span className="text-xs text-[var(--nim-text-faint)]">
                          Update available
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="action-status text-[13px] font-medium text-[var(--nim-text-muted)] whitespace-nowrap py-1.5 px-3">Installed</span>
                        <button
                          className="action-reinstall-button nim-btn-secondary py-1 px-3 rounded-md text-xs font-medium whitespace-nowrap"
                          onClick={() => handleUninstallPackage(pkg.id)}
                          disabled={isProcessing}
                        >
                          Uninstall
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettingsScreen;
