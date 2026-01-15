/**
 * usePanels Hook
 *
 * React hook for accessing registered extension panels.
 * Automatically updates when panels are loaded/unloaded.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getRegisteredPanels,
  getPanelsByPlacement,
  subscribeToPanelRegistry,
  type RegisteredPanel,
} from './PanelRegistry';

/**
 * Hook that returns all registered panels and updates when they change.
 */
export function usePanels(): RegisteredPanel[] {
  const [panels, setPanels] = useState<RegisteredPanel[]>(() => getRegisteredPanels());

  useEffect(() => {
    // Sync immediately
    setPanels(getRegisteredPanels());

    // Subscribe to changes
    const unsubscribe = subscribeToPanelRegistry(() => {
      setPanels(getRegisteredPanels());
    });

    return unsubscribe;
  }, []);

  return panels;
}

/**
 * Hook that returns panels filtered by placement type.
 */
export function usePanelsByPlacement(
  placement: 'sidebar' | 'fullscreen' | 'floating'
): RegisteredPanel[] {
  const [panels, setPanels] = useState<RegisteredPanel[]>(() =>
    getPanelsByPlacement(placement)
  );

  useEffect(() => {
    // Sync immediately
    setPanels(getPanelsByPlacement(placement));

    // Subscribe to changes
    const unsubscribe = subscribeToPanelRegistry(() => {
      setPanels(getPanelsByPlacement(placement));
    });

    return unsubscribe;
  }, [placement]);

  return panels;
}

/**
 * Hook that returns gutter button data for extension panels.
 */
export function useExtensionGutterButtons(): Array<{
  id: string;
  icon: string;
  label: string;
  placement: 'sidebar' | 'fullscreen';
  order: number;
}> {
  const [buttons, setButtons] = useState<Array<{
    id: string;
    icon: string;
    label: string;
    placement: 'sidebar' | 'fullscreen';
    order: number;
  }>>([]);

  useEffect(() => {
    function updateButtons(): void {
      const panels = getRegisteredPanels();
      const gutterButtons = panels
        .filter(p => p.placement === 'sidebar' || p.placement === 'fullscreen')
        .map(p => ({
          id: p.id,
          icon: p.icon,
          label: p.title,
          placement: p.placement as 'sidebar' | 'fullscreen',
          order: p.order,
        }));

      setButtons(gutterButtons);
    }

    updateButtons();
    const unsubscribe = subscribeToPanelRegistry(updateButtons);
    return unsubscribe;
  }, []);

  return buttons;
}
