/**
 * WalkthroughProvider Component
 *
 * Context provider that manages walkthrough state and trigger evaluation.
 * Uses Jotai atoms for state management within the window.
 * State is synced with main process store for persistence across sessions.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import type {
  WalkthroughState,
  WalkthroughContextValue,
  ContentMode,
} from '../types';
import {
  getWalkthroughState,
  setWalkthroughsEnabled,
  markWalkthroughCompleted,
  markWalkthroughDismissed,
  recordWalkthroughShown,
  shouldShowWalkthrough,
  resetWalkthroughState as resetWalkthroughStateIPC,
  resolveTarget,
  registerWalkthroughMenuEntries,
} from '../WalkthroughService';
import { WalkthroughCallout } from './WalkthroughCallout';
import { walkthroughs } from '../definitions';
import {
  walkthroughStateAtom,
  activeWalkthroughIdAtom,
  currentStepIndexAtom,
} from '../atoms';
import { errorNotificationService } from '../../services/ErrorNotificationService';

const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

interface WalkthroughProviderProps {
  children: ReactNode;
  /** Current content mode (files/agent/settings) - from App.tsx */
  currentMode: ContentMode;
  /** Whether to enable automatic walkthrough triggering */
  autoTrigger?: boolean;
}

export function WalkthroughProvider({
  children,
  currentMode,
  autoTrigger = true,
}: WalkthroughProviderProps) {
  const posthog = usePostHog();

  // Jotai atoms for state
  const [state, setState] = useAtom(walkthroughStateAtom);
  const [activeWalkthroughId, setActiveWalkthroughId] = useAtom(activeWalkthroughIdAtom);
  const [currentStepIndex, setCurrentStepIndex] = useAtom(currentStepIndexAtom);

  // Track whether we've already triggered for this mode to avoid re-triggering
  const lastTriggeredModeRef = useRef<string | null>(null);
  const triggerDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load state from main process on mount and register walkthroughs for menu
  useEffect(() => {
    getWalkthroughState().then(setState);

    // Register walkthrough metadata with main process for dynamic Developer menu
    registerWalkthroughMenuEntries(
      walkthroughs.map((w) => ({ id: w.id, name: w.name }))
    );
  }, [setState]);

  // Get current walkthrough definition
  const activeWalkthrough = useMemo(() => {
    if (!activeWalkthroughId) return null;
    return walkthroughs.find((w) => w.id === activeWalkthroughId) ?? null;
  }, [activeWalkthroughId]);

  // Start a walkthrough (can be called manually for testing)
  const startWalkthrough = useCallback(
    (walkthroughId: string, mode?: 'files' | 'agent') => {
      const walkthrough = walkthroughs.find((w) => w.id === walkthroughId);
      if (!walkthrough) {
        console.warn(`[Walkthrough] Unknown walkthrough ID: ${walkthroughId}`);
        return;
      }

      console.log(`[Walkthrough] Starting: ${walkthroughId}`);
      setActiveWalkthroughId(walkthroughId);
      setCurrentStepIndex(0);

      // Record that it was shown (with mode for cooldown tracking)
      recordWalkthroughShown(walkthroughId, walkthrough.version, mode);

      // Track in PostHog
      posthog?.capture('walkthrough_started', {
        walkthrough_id: walkthroughId,
        walkthrough_name: walkthrough.name,
        total_steps: walkthrough.steps.length,
        mode,
      });
    },
    [posthog, setActiveWalkthroughId, setCurrentStepIndex]
  );

  // Dismiss current walkthrough
  const dismissWalkthrough = useCallback(() => {
    if (!activeWalkthrough) return;

    // Track in PostHog
    posthog?.capture('walkthrough_dismissed', {
      walkthrough_id: activeWalkthrough.id,
      walkthrough_name: activeWalkthrough.name,
      step_dismissed_at: currentStepIndex,
      total_steps: activeWalkthrough.steps.length,
    });

    // Mark as dismissed in store
    markWalkthroughDismissed(activeWalkthrough.id, activeWalkthrough.version);

    // Update local state
    setState((prev) =>
      prev
        ? {
            ...prev,
            dismissed: [...prev.dismissed, activeWalkthrough.id],
          }
        : prev
    );

    setActiveWalkthroughId(null);
    setCurrentStepIndex(0);
  }, [activeWalkthrough, currentStepIndex, posthog, setState, setActiveWalkthroughId, setCurrentStepIndex]);

  // Complete current walkthrough
  const completeWalkthrough = useCallback(() => {
    if (!activeWalkthrough) return;

    // Track in PostHog
    posthog?.capture('walkthrough_completed', {
      walkthrough_id: activeWalkthrough.id,
      walkthrough_name: activeWalkthrough.name,
      steps_viewed: currentStepIndex + 1,
    });

    // Mark as completed in store
    markWalkthroughCompleted(activeWalkthrough.id, activeWalkthrough.version);

    // Update local state
    setState((prev) =>
      prev
        ? {
            ...prev,
            completed: [...prev.completed, activeWalkthrough.id],
          }
        : prev
    );

    setActiveWalkthroughId(null);
    setCurrentStepIndex(0);
  }, [activeWalkthrough, currentStepIndex, posthog, setState, setActiveWalkthroughId, setCurrentStepIndex]);

  // Go to next step
  const nextStep = useCallback(() => {
    if (!activeWalkthrough) return;

    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= activeWalkthrough.steps.length) {
      completeWalkthrough();
    } else {
      setCurrentStepIndex(nextIndex);

      // Track step view in PostHog
      posthog?.capture('walkthrough_step_viewed', {
        walkthrough_id: activeWalkthrough.id,
        step_id: activeWalkthrough.steps[nextIndex].id,
        step_index: nextIndex,
      });
    }
  }, [activeWalkthrough, currentStepIndex, completeWalkthrough, posthog, setCurrentStepIndex]);

  // Go to previous step
  const previousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex, setCurrentStepIndex]);

  // Enable/disable walkthroughs globally
  const setEnabled = useCallback((enabled: boolean) => {
    setWalkthroughsEnabled(enabled);
    setState((prev) => (prev ? { ...prev, enabled } : prev));

    // If disabling, also dismiss any active walkthrough
    if (!enabled && activeWalkthroughId) {
      setActiveWalkthroughId(null);
      setCurrentStepIndex(0);
    }
  }, [activeWalkthroughId, setState, setActiveWalkthroughId, setCurrentStepIndex]);

  // Evaluate triggers when mode changes or state loads
  useEffect(() => {
    // Skip if disabled, no state yet, or already showing a walkthrough
    if (!autoTrigger || !state || !state.enabled || activeWalkthroughId) {
      if (import.meta.env.DEV) {
        console.log('[Walkthrough] Trigger check skipped:', {
          autoTrigger,
          hasState: !!state,
          enabled: state?.enabled,
          activeWalkthroughId,
        });
      }
      return;
    }

    // Skip if we already triggered for this mode (prevents re-triggering on every render)
    if (lastTriggeredModeRef.current === currentMode) {
      return;
    }

    // Clear any pending trigger
    if (triggerDelayRef.current) {
      clearTimeout(triggerDelayRef.current);
    }

    // Find eligible walkthroughs for current mode
    // Only track cooldown for files/agent modes (not settings)
    const modeForCooldown = currentMode === 'files' || currentMode === 'agent' ? currentMode : undefined;

    const eligible = walkthroughs
      .filter((w) => {
        // Check if should show based on state (including cooldown check)
        if (!shouldShowWalkthrough(state, w, modeForCooldown)) {
          if (import.meta.env.DEV) {
            console.log(`[Walkthrough] ${w.id} filtered out by shouldShowWalkthrough`);
          }
          return false;
        }

        // Check screen trigger
        const screenMatch =
          w.trigger.screen === '*' || w.trigger.screen === currentMode;
        if (!screenMatch) {
          if (import.meta.env.DEV) {
            console.log(`[Walkthrough] ${w.id} filtered out by screen mismatch (${w.trigger.screen} vs ${currentMode})`);
          }
          return false;
        }

        // Check custom condition if provided
        if (w.trigger.condition && !w.trigger.condition()) {
          if (import.meta.env.DEV) {
            console.log(`[Walkthrough] ${w.id} filtered out by condition`);
          }
          return false;
        }

        return true;
      })
      .sort((a, b) => (b.trigger.priority ?? 0) - (a.trigger.priority ?? 0));

    if (import.meta.env.DEV) {
      console.log('[Walkthrough] Eligible walkthroughs:', eligible.map(w => w.id));
    }

    if (eligible.length > 0) {
      const walkthrough = eligible[0];
      const delay = walkthrough.trigger.delay ?? 500;

      if (import.meta.env.DEV) {
        console.log(`[Walkthrough] Will trigger ${walkthrough.id} in ${delay}ms`);
      }

      // Delay trigger to let UI settle
      triggerDelayRef.current = setTimeout(() => {
        // Re-check condition right before triggering (UI may have changed)
        if (walkthrough.trigger.condition && !walkthrough.trigger.condition()) {
          if (import.meta.env.DEV) {
            console.log(`[Walkthrough] ${walkthrough.id} condition failed at trigger time, skipping`);
          }
          return;
        }
        lastTriggeredModeRef.current = currentMode;
        startWalkthrough(walkthrough.id, modeForCooldown);
      }, delay);
    }

    return () => {
      if (triggerDelayRef.current) {
        clearTimeout(triggerDelayRef.current);
      }
    };
  }, [currentMode, state, activeWalkthroughId, autoTrigger, startWalkthrough]);

  // Expose test helpers in development mode
  useEffect(() => {
    if (import.meta.env.DEV) {
      const helpers = {
        // List all available walkthroughs
        listWalkthroughs: () => {
          console.table(walkthroughs.map(w => ({
            id: w.id,
            name: w.name,
            screen: w.trigger.screen,
            priority: w.trigger.priority,
            steps: w.steps.length,
          })));
          return walkthroughs.map(w => w.id);
        },
        // Start a specific walkthrough by ID
        startWalkthrough: (id: string) => {
          startWalkthrough(id);
        },
        // Dismiss current walkthrough
        dismissWalkthrough: () => {
          dismissWalkthrough();
        },
        // Get current state
        getState: () => ({
          state,
          activeWalkthroughId,
          currentStepIndex,
          activeWalkthrough,
        }),
        // Reset all walkthrough state (re-show all guides)
        resetState: async () => {
          await resetWalkthroughStateIPC();
          const newState = await getWalkthroughState();
          setState(newState);
          lastTriggeredModeRef.current = null;
          console.log('[Walkthrough] State reset');
        },
      };

      (window as any).__walkthroughHelpers = helpers;
      console.log('[Walkthrough] Dev helpers available at window.__walkthroughHelpers');
      console.log('  - listWalkthroughs(): Show all available walkthroughs');
      console.log('  - startWalkthrough(id): Start a specific walkthrough');
      console.log('  - dismissWalkthrough(): Dismiss current walkthrough');
      console.log('  - getState(): Get current walkthrough state');
      console.log('  - resetState(): Reset all walkthrough progress');
    }

    return () => {
      if (import.meta.env.DEV) {
        delete (window as any).__walkthroughHelpers;
      }
    };
  }, [state, activeWalkthroughId, currentStepIndex, activeWalkthrough, startWalkthrough, dismissWalkthrough, setState]);

  // Listen for IPC messages from main process (Developer menu triggers)
  useEffect(() => {
    const handleTriggerWalkthrough = (walkthroughId: string) => {
      const walkthrough = walkthroughs.find((w) => w.id === walkthroughId);
      if (!walkthrough) {
        errorNotificationService.showInfo(
          'Walkthrough Not Found',
          `Unknown walkthrough: ${walkthroughId}`,
          { duration: 3000 }
        );
        return;
      }

      // Check if the first step's target element exists on the page
      const firstStep = walkthrough.steps[0];
      const targetElement = resolveTarget(firstStep.target);

      if (!targetElement) {
        errorNotificationService.showInfo(
          'Cannot Show Walkthrough',
          `"${walkthrough.name}" requires UI elements that aren't visible on this screen. Try switching to ${walkthrough.trigger.screen === 'agent' ? 'Agent Mode' : 'Files Mode'} first.`,
          { duration: 5000 }
        );
        return;
      }

      // Check if walkthrough's condition is met
      if (walkthrough.trigger.condition && !walkthrough.trigger.condition()) {
        errorNotificationService.showInfo(
          'Cannot Show Walkthrough',
          `"${walkthrough.name}" conditions aren't met. Try switching to ${walkthrough.trigger.screen === 'agent' ? 'Agent Mode' : 'Files Mode'} first.`,
          { duration: 5000 }
        );
        return;
      }

      // Start the walkthrough
      startWalkthrough(walkthroughId);
    };

    const handleResetWalkthroughs = async () => {
      await resetWalkthroughStateIPC();
      const newState = await getWalkthroughState();
      setState(newState);
      lastTriggeredModeRef.current = null;
      errorNotificationService.showInfo(
        'Walkthroughs Reset',
        'All walkthrough guides will show again.',
        { duration: 3000 }
      );
    };

    // Subscribe to IPC events
    const unsubscribeTrigger = window.electronAPI.on('trigger-walkthrough', handleTriggerWalkthrough);
    const unsubscribeReset = window.electronAPI.on('reset-walkthroughs', handleResetWalkthroughs);

    return () => {
      unsubscribeTrigger?.();
      unsubscribeReset?.();
    };
  }, [startWalkthrough, setState]);

  // Context value
  const contextValue = useMemo<WalkthroughContextValue>(
    () => ({
      state,
      activeWalkthroughId,
      currentStepIndex,
      startWalkthrough,
      dismissWalkthrough,
      completeWalkthrough,
      nextStep,
      previousStep,
      setEnabled,
    }),
    [
      state,
      activeWalkthroughId,
      currentStepIndex,
      startWalkthrough,
      dismissWalkthrough,
      completeWalkthrough,
      nextStep,
      previousStep,
      setEnabled,
    ]
  );

  return (
    <WalkthroughContext.Provider value={contextValue}>
      {children}
      {activeWalkthrough && (
        <WalkthroughCallout
          definition={activeWalkthrough}
          stepIndex={currentStepIndex}
          onNext={nextStep}
          onBack={previousStep}
          onDismiss={dismissWalkthrough}
          onComplete={completeWalkthrough}
        />
      )}
    </WalkthroughContext.Provider>
  );
}

/**
 * Hook to access walkthrough context
 */
export function useWalkthrough(): WalkthroughContextValue {
  const context = useContext(WalkthroughContext);
  if (!context) {
    throw new Error('useWalkthrough must be used within a WalkthroughProvider');
  }
  return context;
}

/**
 * Hook to access walkthrough context (safe version that returns null if not in provider)
 */
export function useWalkthroughSafe(): WalkthroughContextValue | null {
  return useContext(WalkthroughContext);
}
