import { useEffect, useCallback, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { dialogRef, dialogReadyAtom } from '../contexts/DialogContext';
import { DIALOG_IDS } from '../dialogs';
import type { OnboardingData, UnifiedOnboardingData, WindowsClaudeCodeWarningData } from '../dialogs';
import OnboardingService from '../services/OnboardingService';
import type { ContentMode } from '../types/WindowModeTypes';

interface UseOnboardingOptions {
  workspacePath: string | null;
  workspaceMode: boolean;
  isInitializing: boolean;
  setActiveMode: (mode: ContentMode) => void;
}

interface UseOnboardingReturn {
  /** Check if commands toast should be shown and show it if needed */
  checkAndShowCommandsToast: () => Promise<boolean>;
}

/**
 * Hook that manages all onboarding-related dialogs and logic.
 *
 * This includes:
 * - Unified onboarding dialog (first-time user flow)
 * - Windows Claude Code warning (Windows-specific)
 * - Claude commands install toast checking
 * - IPC listeners for developer menu triggers
 */
export function useOnboarding({
  workspacePath,
  workspaceMode,
  isInitializing,
  setActiveMode,
}: UseOnboardingOptions): UseOnboardingReturn {
  const posthog = usePostHog();
  const dialogReady = useAtomValue(dialogReadyAtom);

  // Track state for onboarding flow
  const onboardingOpenRef = useRef(false);
  const windowsWarningOpenRef = useRef(false);
  const forcedModeRef = useRef<'new' | 'existing' | null>(null);

  // Handle unified onboarding completion
  const handleOnboardingComplete = useCallback(async (data: OnboardingData) => {
    const roleToStore = data.customRole || data.role || undefined;

    // Store onboarding data in electron-store (app settings)
    await window.electronAPI.invoke('onboarding:update', {
      userRole: roleToStore,
      userEmail: data.email || undefined,
      referralSource: data.referralSource || undefined,
      unifiedOnboardingCompleted: true,
      onboardingCompleted: true, // Keep for backward compatibility
    });

    // Store developer mode globally in app settings
    await window.electronAPI.invoke('developer-mode:set', data.developerMode);

    if (posthog) {
      // Set person properties (persist to user profile)
      const personProperties: Record<string, string | boolean> = {
        developer_mode: data.developerMode,
      };
      if (data.email) {
        personProperties.email = data.email;
      }
      if (data.role) {
        personProperties.user_role = data.customRole || data.role;
      }
      if (data.referralSource) {
        personProperties.referral_source = data.referralSource;
      }
      posthog.people.set(personProperties);

      // Submit survey response (role and referral source)
      const surveyId = '019becdc-8139-0000-0946-e76c18c36ef7';
      if (data.role || data.referralSource) {
        const surveyPayload: Record<string, string> = {
          $survey_id: surveyId,
          $survey_name: 'Onboarding Profile Survey',
        };
        // Map role value to survey choice label
        const roleLabels: Record<string, string> = {
          developer: 'Software Developer',
          product_manager: 'Product Manager',
          designer: 'Designer',
          writer: 'Writer / Content',
          researcher: 'Researcher',
          marketing: 'Marketing',
          sales: 'Sales',
          finance: 'Finance',
          student: 'Student',
          hobbyist: 'Hobbyist / Personal Use',
          other: 'Other',
        };
        // Map referral value to survey choice label
        const referralLabels: Record<string, string> = {
          search: 'Search',
          social: 'Social Media',
          friend: 'Friend',
          ai: 'AI',
          ad: 'Ad',
          other: 'Other',
        };

        if (data.role) {
          surveyPayload['$survey_response'] = data.customRole || roleLabels[data.role] || data.role;
        }
        if (data.referralSource) {
          // Handle social:Platform format
          const referralKey = data.referralSource.startsWith('social:') ? 'social' : data.referralSource;
          surveyPayload['$survey_response_1'] = referralLabels[referralKey] || data.referralSource;
        }
        posthog.capture('survey sent', surveyPayload);
      }

      // Track mode selection event (initial)
      posthog.capture('developer_mode_changed', {
        developer_mode: data.developerMode,
        source: 'onboarding',
        is_initial: true,
      });
    }

    onboardingOpenRef.current = false;

    // After onboarding closes, check if we need to show Windows warning
    checkWindowsWarning();
  }, [posthog, workspacePath]);

  // Handle unified onboarding skip
  const handleOnboardingSkip = useCallback(async () => {
    // Mark as completed to prevent re-showing
    await window.electronAPI.invoke('onboarding:update', {
      unifiedOnboardingCompleted: true,
      onboardingCompleted: true, // Keep for backward compatibility
    });

    // Track skip event
    if (posthog) {
      posthog.capture('unified_onboarding_skipped');
    }

    onboardingOpenRef.current = false;

    // After onboarding closes, check if we need to show Windows warning
    checkWindowsWarning();
  }, [posthog]);

  // Check if we should show the Windows Claude Code warning
  const checkWindowsWarning = useCallback(async () => {
    // Only run on Windows
    if (navigator.platform !== 'Win32') return;

    // Skip in Playwright tests
    if ((window as any).PLAYWRIGHT) return;

    // Only show in workspace mode windows
    if (!workspaceMode) return;

    try {
      // Check if we should show the warning (Windows only, not dismissed)
      const shouldShow = await window.electronAPI.invoke('claude-code:should-show-windows-warning');
      if (!shouldShow) return;

      // Check if Claude Code is installed
      const installation = await window.electronAPI.cliCheckClaudeCodeWindowsInstallation();
      if (installation.claudeCodeVersion) {
        // Claude Code is installed, no warning needed
        return;
      }

      // Show the warning via DialogProvider
      if (dialogRef.current) {
        windowsWarningOpenRef.current = true;
        dialogRef.current.open<WindowsClaudeCodeWarningData>(DIALOG_IDS.WINDOWS_CLAUDE_CODE_WARNING, {
          onClose: () => {
            posthog?.capture('windows_claude_code_warning_closed');
            windowsWarningOpenRef.current = false;
          },
          onDismiss: () => {
            posthog?.capture('windows_claude_code_warning_dismissed_forever');
            windowsWarningOpenRef.current = false;
          },
          onOpenSettings: () => {
            posthog?.capture('windows_claude_code_warning_shown');
            windowsWarningOpenRef.current = false;
            setActiveMode('settings');
          },
        });
      }
    } catch (error) {
      console.error('[useOnboarding] Error checking Windows Claude Code warning:', error);
    }
  }, [workspaceMode, posthog, setActiveMode]);

  // Check for unified onboarding on first launch
  // Wait for: initialization complete, dialog system ready, workspace mode
  useEffect(() => {
    if (isInitializing || !dialogReady || !workspaceMode) return;

    const checkUnifiedOnboarding = async () => {
      // Skip in Playwright tests
      if ((window as any).PLAYWRIGHT) {
        return;
      }

      // Small delay to let other windows start up first
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if unified onboarding has been completed
      const state = await window.electronAPI.invoke('onboarding:get');

      // Only check the new unified onboarding flag
      if (state.unifiedOnboardingCompleted) {
        // Onboarding already done, check Windows warning
        checkWindowsWarning();
        return;
      }

      // Show unified onboarding via DialogProvider
      if (dialogRef.current) {
        onboardingOpenRef.current = true;
        dialogRef.current.open<UnifiedOnboardingData>(DIALOG_IDS.ONBOARDING, {
          onComplete: handleOnboardingComplete,
          onSkip: handleOnboardingSkip,
          forcedMode: forcedModeRef.current,
        });
      }
    };

    checkUnifiedOnboarding();
  }, [isInitializing, dialogReady, workspaceMode, handleOnboardingComplete, handleOnboardingSkip, checkWindowsWarning]);

  // Listen for show-unified-onboarding IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowUnifiedOnboarding = (options?: { forceNewUser?: boolean; forceExistingUser?: boolean }) => {
      let forcedMode: 'new' | 'existing' | null = null;
      if (options?.forceNewUser) {
        forcedMode = 'new';
      } else if (options?.forceExistingUser) {
        forcedMode = 'existing';
      }
      forcedModeRef.current = forcedMode;

      if (dialogRef.current) {
        onboardingOpenRef.current = true;
        dialogRef.current.open<UnifiedOnboardingData>(DIALOG_IDS.ONBOARDING, {
          onComplete: handleOnboardingComplete,
          onSkip: handleOnboardingSkip,
          forcedMode,
        });
      }
    };

    window.electronAPI.on('show-unified-onboarding', handleShowUnifiedOnboarding);

    return () => {
      window.electronAPI.off?.('show-unified-onboarding', handleShowUnifiedOnboarding);
    };
  }, [handleOnboardingComplete, handleOnboardingSkip]);

  // Listen for show-windows-claude-code-warning IPC event (from Developer menu)
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleShowWindowsWarning = () => {
      if (dialogRef.current) {
        windowsWarningOpenRef.current = true;
        dialogRef.current.open<WindowsClaudeCodeWarningData>(DIALOG_IDS.WINDOWS_CLAUDE_CODE_WARNING, {
          onClose: () => {
            posthog?.capture('windows_claude_code_warning_closed');
            windowsWarningOpenRef.current = false;
          },
          onDismiss: () => {
            posthog?.capture('windows_claude_code_warning_dismissed_forever');
            windowsWarningOpenRef.current = false;
          },
          onOpenSettings: () => {
            posthog?.capture('windows_claude_code_warning_shown');
            windowsWarningOpenRef.current = false;
            setActiveMode('settings');
          },
        });
      }
    };

    window.electronAPI.on('show-windows-claude-code-warning', handleShowWindowsWarning);

    return () => {
      window.electronAPI.off?.('show-windows-claude-code-warning', handleShowWindowsWarning);
    };
  }, [posthog, setActiveMode]);

  // Check and show commands toast
  const checkAndShowCommandsToast = useCallback(async (): Promise<boolean> => {
    if (!workspacePath || !workspaceMode) return false;

    // Skip in Playwright tests
    if ((window as any).PLAYWRIGHT) return false;

    // Don't show if onboarding or Windows warning is open
    if (onboardingOpenRef.current || windowsWarningOpenRef.current) return false;

    try {
      const needsInstall = await OnboardingService.needsCommandInstallation(workspacePath);
      return needsInstall;
    } catch (error) {
      console.error('[useOnboarding] Error checking command installation:', error);
      return false;
    }
  }, [workspacePath, workspaceMode]);

  return {
    checkAndShowCommandsToast,
  };
}
