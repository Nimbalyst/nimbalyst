/**
 * Onboarding Dialogs Registration
 *
 * These dialogs handle user onboarding, warnings, and first-time setup.
 * They belong to the 'onboarding' group.
 */

import React from 'react';
import { registerDialog } from '../contexts/DialogContext';
import type { DialogConfig } from '../contexts/DialogContext.types';
import { WindowsClaudeCodeWarning } from '../components/WindowsClaudeCodeWarning/WindowsClaudeCodeWarning';
import { UnifiedOnboarding, type OnboardingData } from '../components/UnifiedOnboarding/UnifiedOnboarding';
import { DIALOG_IDS } from './registry';

// Type definitions for dialog data

export interface WindowsClaudeCodeWarningData {
  onClose: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

export interface UnifiedOnboardingData {
  onComplete: (data: OnboardingData) => void;
  onSkip: () => void;
  forcedMode?: 'new' | 'existing' | null;
}

// Re-export OnboardingData for convenience
export type { OnboardingData };

// Wrapper components that bridge DialogComponentProps to the original component props

function WindowsClaudeCodeWarningWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: WindowsClaudeCodeWarningData;
}) {
  return (
    <WindowsClaudeCodeWarning
      isOpen={isOpen}
      onClose={() => {
        data.onClose();
        onClose();
      }}
      onDismiss={() => {
        data.onDismiss();
        onClose();
      }}
      onOpenSettings={() => {
        data.onOpenSettings();
        onClose();
      }}
    />
  );
}

function UnifiedOnboardingWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: UnifiedOnboardingData;
}) {
  return (
    <UnifiedOnboarding
      isOpen={isOpen}
      onComplete={(onboardingData) => {
        data.onComplete(onboardingData);
        onClose();
      }}
      onSkip={() => {
        data.onSkip();
        onClose();
      }}
      forcedMode={data.forcedMode}
    />
  );
}

// Register all onboarding dialogs
export function registerOnboardingDialogs() {
  registerDialog<WindowsClaudeCodeWarningData>({
    id: DIALOG_IDS.WINDOWS_CLAUDE_CODE_WARNING,
    group: 'onboarding',
    component:
      WindowsClaudeCodeWarningWrapper as DialogConfig<WindowsClaudeCodeWarningData>['component'],
    priority: 200, // Onboarding dialogs have medium priority
  });

  registerDialog<UnifiedOnboardingData>({
    id: DIALOG_IDS.ONBOARDING,
    group: 'onboarding',
    component:
      UnifiedOnboardingWrapper as DialogConfig<UnifiedOnboardingData>['component'],
    priority: 210, // Slightly higher than Windows warning
  });
}
