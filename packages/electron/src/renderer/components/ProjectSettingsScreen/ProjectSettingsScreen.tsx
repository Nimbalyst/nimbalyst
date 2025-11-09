import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import './ProjectSettingsScreen.css';
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
    <div className="settings-screen">
      <div className="settings-header">
        <h2>
          <span className="material-symbols-outlined">extension</span>
          Tool Packages for {workspaceName}
        </h2>
        <div className="settings-header-actions">
          <button className="button-get-started" onClick={onClose}>
            Get Started
          </button>
          <button className="settings-close" onClick={onClose} title="Close settings">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="settings-content">
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

        <div className="settings-intro">
          <p>
            Tool packages bundle custom commands and tracker schemas into curated sets for different
            workflows. Each package includes everything you need to get started quickly.
          </p>
        </div>

        {totalCount > 0 && (
          <div className="settings-progress">
            <span className="progress-text">
              {installedCount} of {totalCount} packages installed
              {needsUpdateCount > 0 && ` • ${needsUpdateCount} update${needsUpdateCount > 1 ? 's' : ''} available`}
            </span>
          </div>
        )}

        <div className="settings-section">
          <h3>Available Packages</h3>

          <div className="action-cards">
            {packages.map(({ package: pkg, versionStatus }) => (
              <div
                key={pkg.id}
                className={`action-card ${versionStatus.isInstalled ? 'completed' : ''}`}
              >
                <div className="action-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--primary-color)', fontSize: '24px' }}>
                      {pkg.icon}
                    </span>
                    <h4>{pkg.name}</h4>
                    {versionStatus.isInstalled && versionStatus.installedVersion && (
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                        v{versionStatus.installedVersion}
                      </span>
                    )}
                  </div>
                  <p>{pkg.description}</p>

                  {expandedPackageId === pkg.id && (
                    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)' }}>
                      <div style={{ marginBottom: '12px' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                          Custom Commands ({pkg.customCommands.length})
                        </strong>
                        <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {pkg.customCommands.map(cmd => (
                            <li key={cmd.name} style={{ marginBottom: '4px' }}>
                              <code style={{ background: 'var(--surface-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>
                                /{cmd.name}
                              </code>
                              {' - '}
                              {cmd.description}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                          Tracker Schemas ({pkg.trackerSchemas.length})
                        </strong>
                        <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {pkg.trackerSchemas.map(schema => (
                            <li key={schema.type} style={{ marginBottom: '4px' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>
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
                    style={{
                      marginTop: '12px',
                      padding: '4px 8px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--primary-color)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {expandedPackageId === pkg.id ? 'Hide' : 'Show'} details
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                      {expandedPackageId === pkg.id ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>
                </div>

                {!versionStatus.isInstalled ? (
                  <button
                    className="action-install-button"
                    onClick={() => handleInstallPackage(pkg.id)}
                    disabled={isProcessing}
                  >
                    Install
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                    {versionStatus.needsUpdate ? (
                      <>
                        <button
                          className="action-install-button"
                          onClick={() => handleInstallPackage(pkg.id)}
                          disabled={isProcessing}
                          style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                            upgrade
                          </span>
                          Update to v{versionStatus.latestVersion}
                        </button>
                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                          Update available
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="action-status">Installed</span>
                        <button
                          className="action-reinstall-button"
                          onClick={() => handleUninstallPackage(pkg.id)}
                          disabled={isProcessing}
                          style={{ fontSize: '12px', padding: '4px 12px' }}
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
