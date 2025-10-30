import {AnalyticsService} from "../services/analytics/AnalyticsService.ts";
import {ipcMain} from "electron";

const analytics = AnalyticsService.getInstance();

export function registerAnalyticsHandlers() {
  ipcMain.handle("analytics:allowed", (): boolean => {
    return analytics.allowedToSendAnalytics();
  })

  ipcMain.handle("analytics:get-distinct-id", (): string => {
    return analytics.getDistinctId();
  });

  ipcMain.handle("analytics:opt-in", async (): Promise<void> => {
    return await analytics.optIn();
  });

  ipcMain.handle("analytics:opt-out", async (): Promise<void> => {
    return await analytics.optOut();
  });

  ipcMain.handle("analytics:set-session-id", (_event, sessionId: string): void => {
    return analytics.setSessionId(sessionId);
  });

  // Track keyboard shortcut usage from renderer
  ipcMain.on("analytics:keyboard-shortcut", (_event, data: { shortcut: string; context: string }) => {
    analytics.sendEvent('keyboard_shortcut_used', {
      shortcut: data.shortcut,
      context: data.context,
    });
  });

  // Track toolbar button clicks from renderer
  ipcMain.on("analytics:toolbar-button", (_event, data: { button: string; isFirstUse: boolean }) => {
    analytics.sendEvent('toolbar_button_clicked', {
      button: data.button,
      isFirstUse: data.isFirstUse,
    });
  });

  // Track feature first use
  ipcMain.on("analytics:feature-first-use", (_event, data: { feature: string; daysSinceInstall: string }) => {
    analytics.sendEvent('feature_first_use', {
      feature: data.feature,
      daysSinceInstall: data.daysSinceInstall,
    });
  });
}
