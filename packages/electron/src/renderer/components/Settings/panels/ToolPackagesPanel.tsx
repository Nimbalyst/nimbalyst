import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import PackageService from '../../../services/PackageService';
import { ToolPackage } from '../../../../shared/toolPackages';
import { ClaudeCommandsLearnMoreDialog } from '../../ClaudeCommandsLearnMoreDialog';

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
  const [showLearnMore, setShowLearnMore] = useState(false);

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
      <div className="settings-panel-content flex flex-col p-6">
        <div className="settings-panel-empty text-center py-12 text-[var(--nim-text-muted)]">
          <p>Open a workspace to configure tool packages.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel-content flex flex-col p-6">
      <div className="settings-panel-header mb-6">
        <h2 className="text-xl font-semibold text-[var(--nim-text)] mb-2">Tool Packages for {workspaceName}</h2>
        <p className="text-sm text-[var(--nim-text-muted)] leading-relaxed">
          Tool packages bundle custom commands and tracker schemas into curated sets for different
          workflows. Each package includes everything you need to get started quickly.{' '}
          <button
            className="settings-learn-more-link text-[var(--nim-link)] hover:text-[var(--nim-link-hover)] bg-transparent border-none cursor-pointer underline"
            onClick={() => setShowLearnMore(true)}
          >
            Learn more
          </button>
        </p>
      </div>

      {error && (
        <div className="settings-message error flex items-center gap-2 p-3 mb-4 rounded bg-[var(--nim-error)]/10 text-[var(--nim-error)] text-sm">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="settings-message success flex items-center gap-2 p-3 mb-4 rounded bg-[var(--nim-success)]/10 text-[var(--nim-success)] text-sm">
          <span className="material-symbols-outlined">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      {totalCount > 0 && (
        <div className="packages-progress mb-6">
          <div className="packages-progress-bar h-2 rounded-full bg-[var(--nim-bg-tertiary)] overflow-hidden">
            <div
              className="packages-progress-fill h-full rounded-full bg-[var(--nim-primary)] transition-all"
              style={{ width: `${(installedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="packages-progress-text text-xs text-[var(--nim-text-muted)] mt-2 block">
            {installedCount} of {totalCount} packages installed
            {needsUpdateCount > 0 && ` - ${needsUpdateCount} update${needsUpdateCount > 1 ? 's' : ''} available`}
          </span>
        </div>
      )}

      <div className="packages-section-title text-sm font-medium text-[var(--nim-text)] mb-3">Available Packages</div>

      <div className="packages-list flex flex-col gap-3">
        {packages.map(({ package: pkg, versionStatus }) => (
          <div
            key={pkg.id}
            className={`package-card rounded-lg border p-4 ${
              versionStatus.isInstalled
                ? 'border-[var(--nim-primary)]/30 bg-[var(--nim-primary)]/5'
                : 'border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]'
            }`}
          >
            <div className="package-card-header flex items-start gap-3">
              <div className="package-icon w-10 h-10 rounded-lg bg-[var(--nim-bg-tertiary)] flex items-center justify-center text-[var(--nim-text-muted)]">
                <span className="material-symbols-outlined">{pkg.icon}</span>
              </div>
              <div className="package-info flex-1 min-w-0">
                <div className="package-name text-sm font-medium text-[var(--nim-text)] flex items-center gap-2">
                  {pkg.name}
                  {versionStatus.isInstalled && versionStatus.installedVersion && (
                    <span className="package-version text-xs text-[var(--nim-text-muted)] font-normal">v{versionStatus.installedVersion}</span>
                  )}
                </div>
                <div className="package-description text-xs text-[var(--nim-text-muted)] mt-0.5">{pkg.description}</div>
              </div>
              <div className="package-actions flex items-center gap-2">
                {!versionStatus.isInstalled ? (
                  <button
                    className="btn-install px-3 py-1.5 rounded text-xs font-medium bg-[var(--nim-primary)] text-white hover:bg-[var(--nim-primary-hover)] disabled:opacity-50 cursor-pointer"
                    onClick={() => handleInstallPackage(pkg.id)}
                    disabled={isProcessing}
                  >
                    Install
                  </button>
                ) : versionStatus.needsUpdate ? (
                  <>
                    <button
                      className="btn-install px-3 py-1.5 rounded text-xs font-medium bg-[var(--nim-primary)] text-white hover:bg-[var(--nim-primary-hover)] disabled:opacity-50 cursor-pointer"
                      onClick={() => handleInstallPackage(pkg.id)}
                      disabled={isProcessing}
                    >
                      Update to v{versionStatus.latestVersion}
                    </button>
                    <button
                      className="btn-uninstall px-3 py-1.5 rounded text-xs font-medium border border-[var(--nim-border)] bg-transparent text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 cursor-pointer"
                      onClick={() => handleUninstallPackage(pkg.id)}
                      disabled={isProcessing}
                    >
                      Uninstall
                    </button>
                  </>
                ) : (
                  <>
                    <span className="package-status-installed text-xs text-[var(--nim-success)] font-medium">Installed</span>
                    <button
                      className="btn-uninstall px-3 py-1.5 rounded text-xs font-medium border border-[var(--nim-border)] bg-transparent text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 cursor-pointer"
                      onClick={() => handleUninstallPackage(pkg.id)}
                      disabled={isProcessing}
                    >
                      Uninstall
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="package-details mt-3 pt-3 border-t border-[var(--nim-border)]">
              <button
                className="package-details-toggle flex items-center gap-1 text-xs text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] bg-transparent border-none cursor-pointer p-0"
                onClick={() => togglePackageDetails(pkg.id)}
              >
                <span>{expandedPackageId === pkg.id ? 'Hide details' : 'Show details'}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points={expandedPackageId === pkg.id ? '18,15 12,9 6,15' : '6,9 12,15 18,9'} />
                </svg>
              </button>

              {expandedPackageId === pkg.id && (
                <div className="package-details-content mt-3 flex flex-col gap-4">
                  <div className="package-details-section">
                    <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">
                      Custom Commands ({pkg.customCommands.length})
                    </div>
                    <div className="package-commands flex flex-wrap gap-1.5">
                      {pkg.customCommands.map(cmd => (
                        <span key={cmd.name} className="package-command px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono">/{cmd.name}</span>
                      ))}
                    </div>
                  </div>

                  <div className="package-details-section">
                    <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">
                      Tracker Schemas ({pkg.trackerSchemas.length})
                    </div>
                    <div className="package-schemas flex flex-wrap gap-1.5">
                      {pkg.trackerSchemas.map(schema => (
                        <span key={schema.type} className="package-schema px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">{schema.icon}</span>
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

      <ClaudeCommandsLearnMoreDialog
        isOpen={showLearnMore}
        onClose={() => setShowLearnMore(false)}
        onOpenSettings={() => {
          // Already on settings screen, just close the dialog
          setShowLearnMore(false);
        }}
      />
    </div>
  );
};
