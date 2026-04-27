import React from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  advancedSettingsAtom,
  setAdvancedSettingsAtom,
  aiDebugSettingsAtom,
  setAIDebugSettingsAtom,
} from '../../store/atoms/appSettings';
import { autoCommitEnabledAtom, setAutoCommitEnabledAtom } from '../../store/atoms/autoCommitAtoms';
import { ALPHA_FEATURES, type AlphaFeatureTag } from '../../../shared/alphaFeatures';
import { AlphaBadge } from '../common/AlphaBadge';
import { SettingsToggle } from '../GlobalSettings/SettingsToggle';

const AGENT_FEATURE_TAGS: AlphaFeatureTag[] = [
  'super-loops',
  'blitz',
  'meta-agent',
];

export function AgentFeaturesPanel() {
  const posthog = usePostHog();
  const [settings] = useAtom(advancedSettingsAtom);
  const [, updateSettings] = useAtom(setAdvancedSettingsAtom);
  const { alphaFeatures } = settings;

  const autoCommitEnabled = useAtomValue(autoCommitEnabledAtom);
  const setAutoCommitEnabled = useSetAtom(setAutoCommitEnabledAtom);

  const [aiDebugSettings] = useAtom(aiDebugSettingsAtom);
  const [, updateAIDebugSettings] = useAtom(setAIDebugSettingsAtom);
  const { showToolCalls, aiDebugLogging, showPromptAdditions } = aiDebugSettings;

  const isDevelopment = import.meta.env.DEV;

  const handleAlphaToggle = (tag: AlphaFeatureTag, enabled: boolean) => {
    updateSettings({
      alphaFeatures: { ...alphaFeatures, [tag]: enabled },
    });
    posthog?.capture('alpha_feature_toggled', {
      feature_tag: tag,
      enabled,
      source: 'agent_features_panel',
    });
  };

  const features = AGENT_FEATURE_TAGS
    .map((tag) => ALPHA_FEATURES.find((f) => f.tag === tag))
    .filter((f): f is (typeof ALPHA_FEATURES)[number] => f != null);

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">
          Agent Features
        </h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Settings that control how agent sessions behave.
        </p>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)]">
        <SettingsToggle
          checked={autoCommitEnabled}
          onChange={(checked) => {
            setAutoCommitEnabled(checked);
            posthog?.capture('auto_commit_toggled', { enabled: checked });
          }}
          name="Auto-approve Commits"
          description="Automatically approve when Claude proposes git commits."
        />
      </div>

      <div className="provider-panel-section">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="provider-panel-section-title text-base font-semibold text-[var(--nim-text)] m-0">Experimental</h4>
          <AlphaBadge size="sm" />
        </div>

        <div className="flex items-start gap-2 p-3 mb-3 rounded border border-[var(--nim-warning)]/30 bg-[var(--nim-warning)]/10">
          <MaterialSymbol icon="science" size={16} className="text-[var(--nim-warning)] shrink-0 mt-0.5" />
          <p className="m-0 text-[13px] text-[var(--nim-text)] leading-snug">
            These features may change, regress, or be removed. Some require a restart to take full effect.
          </p>
        </div>

        {features.map((feature) => (
          <SettingsToggle
            key={feature.tag}
            checked={alphaFeatures[feature.tag] ?? false}
            onChange={(checked) => handleAlphaToggle(feature.tag, checked)}
            name={feature.name}
            description={feature.description}
          />
        ))}
      </div>

      {isDevelopment && (
        <div className="provider-panel-section py-4 mt-4 border-t border-[var(--nim-border)]">
          <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">Developer Options</h4>
          <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-2">
            Only available in development mode.
          </p>

          <SettingsToggle
            checked={showToolCalls}
            onChange={(checked) => updateAIDebugSettings({ showToolCalls: checked })}
            name="Show All Tool Calls"
            description="Display all MCP tool calls in the AI chat sidebar, including Edit/applyDiff calls."
          />

          <SettingsToggle
            checked={aiDebugLogging}
            onChange={(checked) => updateAIDebugSettings({ aiDebugLogging: checked })}
            name="AI Debug Logging"
            description="Capture detailed logs of all AI editing operations including LLM requests/responses."
          />

          <SettingsToggle
            checked={showPromptAdditions}
            onChange={(checked) => updateAIDebugSettings({ showPromptAdditions: checked })}
            name="Show Prompt Additions"
            description="Display system prompt additions and context that Nimbalyst appends to Claude Code requests."
          />
        </div>
      )}
    </div>
  );
}
