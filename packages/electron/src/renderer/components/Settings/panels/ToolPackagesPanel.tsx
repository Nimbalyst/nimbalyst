import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import PackageService from '../../../services/PackageService';
import { ToolPackage } from '../../../../shared/toolPackages';

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

interface ToolPackagesPanelProps {
  workspacePath: string;
  workspaceName: string;
  isFirstTime?: boolean;
  onPackagesChange?: (installed: number, total: number) => void;
}

export const ToolPackagesPanel: React.FC<ToolPackagesPanelProps> = ({
  workspacePath,
  workspaceName,
  isFirstTime = false,
  onPackagesChange,
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
      if (!workspacePath) return;
      PackageService.setWorkspacePath(workspacePath);
      const packagesWithStatus = await PackageService.getAllPackagesWithVersionStatus();
      setPackages(packagesWithStatus);
    };

    loadPackages();
  }, [workspacePath]);

  // Notify parent of package count changes
  useEffect(() => {
    if (packages.length > 0 && onPackagesChange) {
      const installedCount = packages.filter(p => p.versionStatus.isInstalled).length;
      onPackagesChange(installedCount, packages.length);
    }
  }, [packages, onPackagesChange]);

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

  const handleInstallPackage = useCallback(async (packageId: string) => {
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
  }, [packages, posthog]);

  const handleUninstallPackage = useCallback(async (packageId: string) => {
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
  }, [packages, posthog]);

  const togglePackageDetails = (packageId: string) => {
    setExpandedPackageId(expandedPackageId === packageId ? null : packageId);
  };

  const installedCount = packages.filter(p => p.versionStatus.isInstalled).length;
  const needsUpdateCount = packages.filter(p => p.versionStatus.needsUpdate).length;
  const totalCount = packages.length;

  if (!workspacePath) {
    return (
      <div className="settings-panel-content">
        <div className="settings-panel-empty">
          <p>Open a workspace to configure tool packages.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel-content">
      <div className="settings-panel-header">
        <h2>Tool Packages for {workspaceName}</h2>
        <p>
          Tool packages bundle custom commands and tracker schemas into curated sets for different
          workflows. Each package includes everything you need to get started quickly.
        </p>
      </div>

      {error && (
        <div className="settings-message error">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="settings-message success">
          <span className="material-symbols-outlined">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      {totalCount > 0 && (
        <div className="packages-progress">
          <div className="packages-progress-bar">
            <div
              className="packages-progress-fill"
              style={{ width: `${(installedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="packages-progress-text">
            {installedCount} of {totalCount} packages installed
            {needsUpdateCount > 0 && ` - ${needsUpdateCount} update${needsUpdateCount > 1 ? 's' : ''} available`}
          </span>
        </div>
      )}

      <div className="packages-section-title">Available Packages</div>

      <div className="packages-list">
        {packages.map(({ package: pkg, versionStatus }) => (
          <div
            key={pkg.id}
            className={`package-card ${versionStatus.isInstalled ? 'installed' : ''}`}
          >
            <div className="package-card-header">
              <div className="package-icon">
                <span className="material-symbols-outlined">{pkg.icon}</span>
              </div>
              <div className="package-info">
                <div className="package-name">
                  {pkg.name}
                  {versionStatus.isInstalled && versionStatus.installedVersion && (
                    <span className="package-version">v{versionStatus.installedVersion}</span>
                  )}
                </div>
                <div className="package-description">{pkg.description}</div>
              </div>
              <div className="package-actions">
                {!versionStatus.isInstalled ? (
                  <button
                    className="btn-install"
                    onClick={() => handleInstallPackage(pkg.id)}
                    disabled={isProcessing}
                  >
                    Install
                  </button>
                ) : versionStatus.needsUpdate ? (
                  <>
                    <button
                      className="btn-install"
                      onClick={() => handleInstallPackage(pkg.id)}
                      disabled={isProcessing}
                    >
                      Update to v{versionStatus.latestVersion}
                    </button>
                    <button
                      className="btn-uninstall"
                      onClick={() => handleUninstallPackage(pkg.id)}
                      disabled={isProcessing}
                    >
                      Uninstall
                    </button>
                  </>
                ) : (
                  <>
                    <span className="package-status-installed">Installed</span>
                    <button
                      className="btn-uninstall"
                      onClick={() => handleUninstallPackage(pkg.id)}
                      disabled={isProcessing}
                    >
                      Uninstall
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="package-details">
              <button
                className="package-details-toggle"
                onClick={() => togglePackageDetails(pkg.id)}
              >
                <span>{expandedPackageId === pkg.id ? 'Hide details' : 'Show details'}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points={expandedPackageId === pkg.id ? '18,15 12,9 6,15' : '6,9 12,15 18,9'} />
                </svg>
              </button>

              {expandedPackageId === pkg.id && (
                <div className="package-details-content">
                  <div className="package-details-section">
                    <div className="package-details-section-title">
                      Custom Commands ({pkg.customCommands.length})
                    </div>
                    <div className="package-commands">
                      {pkg.customCommands.map(cmd => (
                        <span key={cmd.name} className="package-command">/{cmd.name}</span>
                      ))}
                    </div>
                  </div>

                  <div className="package-details-section">
                    <div className="package-details-section-title">
                      Tracker Schemas ({pkg.trackerSchemas.length})
                    </div>
                    <div className="package-schemas">
                      {pkg.trackerSchemas.map(schema => (
                        <span key={schema.type} className="package-schema">
                          <span className="material-symbols-outlined">{schema.icon}</span>
                          {schema.displayName}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
