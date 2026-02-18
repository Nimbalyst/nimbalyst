import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  advancedSettingsAtom,
  setAdvancedSettingsAtom,
  setProviderConfigAtom,
} from '../../../store/atoms/appSettings';
import {
  BETA_FEATURES,
  areAllBetaFeaturesEnabled,
  enableAllBetaFeatures as enableAllBetaFeaturesUtil,
  disableAllBetaFeatures,
} from '../../../../shared/betaFeatures';

/**
 * BetaFeaturesPanel - Settings panel for toggling beta features.
 *
 * Always visible in Settings > Advanced > Beta Features.
 * Unlike alpha features (hidden behind release channel), beta features
 * are user-facing and discoverable.
 */
export function BetaFeaturesPanel() {
  const [settings] = useAtom(advancedSettingsAtom);
  const [, updateSettings] = useAtom(setAdvancedSettingsAtom);
  const updateProviderConfig = useSetAtom(setProviderConfigAtom);

  const { betaFeatures, enableAllBetaFeatures } = settings;

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">
          Beta Features
        </h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Try out new features before they are generally available. Beta features may not be fully complete or polished, and may be removed in the future.
        </p>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <div className="p-3 bg-nim-secondary rounded-md border border-nim">
          {/* "Enable All Beta Features" master toggle */}
          <div className="setting-item mb-3 pb-3 border-b border-nim">
            <label className="setting-label flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enableAllBetaFeatures}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  const newFeatures = enabled ? enableAllBetaFeaturesUtil() : disableAllBetaFeatures();
                  updateSettings({
                    enableAllBetaFeatures: enabled,
                    betaFeatures: newFeatures,
                  });
                  // Sync codex provider enabled state with the beta feature
                  if (newFeatures.codex !== undefined) {
                    updateProviderConfig({ providerId: 'openai-codex', config: { enabled: newFeatures.codex } });
                  }
                }}
                className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
              />
              <div className="setting-text flex flex-col gap-0.5">
                <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Enable All Beta Features</span>
                <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                  Automatically enable all current and future beta features. Individual features can still be toggled below.
                </span>
              </div>
            </label>
          </div>

          {/* Individual beta feature toggles */}
          {BETA_FEATURES.map((feature) => (
            <div
              key={feature.tag}
              className={`setting-item py-2 ${enableAllBetaFeatures ? 'opacity-60 pointer-events-none' : ''}`}
            >
              <label className="setting-label flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={betaFeatures[feature.tag] ?? false}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateSettings({ betaFeatures: { ...betaFeatures, [feature.tag]: checked } });
                    // Sync codex provider enabled state with the beta feature
                    if (feature.tag === 'codex') {
                      updateProviderConfig({ providerId: 'openai-codex', config: { enabled: checked } });
                    }
                  }}
                  className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
                  disabled={enableAllBetaFeatures}
                />
                <div className="setting-text flex flex-col gap-0.5">
                  <span className="setting-name text-sm font-medium text-[var(--nim-text)] flex items-center gap-2">
                    {feature.icon && (
                      <span className="material-symbols-outlined text-sm">{feature.icon}</span>
                    )}
                    {feature.name}
                  </span>
                  <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                    {feature.description}
                  </span>
                  {feature.tag === 'codex' && (
                    <span className="setting-description text-xs leading-relaxed text-[var(--nim-warning)]">
                      Beta: Some functionality, such as red/green diffs in files, is not yet working.
                    </span>
                  )}
                </div>
              </label>
            </div>
          ))}
        </div>
        <p className="mt-3 p-2 text-[13px] text-[var(--nim-text-muted)] bg-nim-secondary rounded border border-nim">
          Some beta features may require restarting Nimbalyst to take effect.
        </p>
      </div>
    </div>
  );
}
