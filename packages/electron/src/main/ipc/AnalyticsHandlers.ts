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

  ipcMain.handle("analytics:send-event", (_event, eventName: string, properties?: Record<string | number, any>): void => {
    return analytics.sendEvent(eventName, properties);
  });
}
