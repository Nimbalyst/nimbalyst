import Store from "electron-store";
import {PostHog} from "posthog-node";
import {ulid} from "ulid";
import {logger} from "../../utils/logger.ts";
import {beforePosthogSendNodeJS} from "./analytics-utils.ts";
import {app} from "electron";

const POSTHOG_PROJECT_PUBLIC_ID = 'phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw';

type AnalyticsSettings = {
  analyticsEnabled: boolean;
  analyticsId: string;
}

/**
 * Singleton analytics service for server side (electron) events. If you need to send events from the renderer on
 * the other side of the IPC boundary, use the usePostHog react hook from posthog-js/react to get the client-side
 * posthog instance.
 */
export class AnalyticsService {

  private log = logger.analytics;

  private static instance: AnalyticsService = new AnalyticsService();

  public static getInstance(): AnalyticsService {
    return this.instance;
  }

  private constructor() {
    this.init();
  }

  private settingsStore?: Store<AnalyticsSettings>;
  private postHogClient?: PostHog;
  private sessionTracker?: PostHog; // only used to track session start times
  private distinctId?: string;
  private sessionId?: string;
  private isDevInstallation: boolean = process.env.NODE_ENV?.toLowerCase() === 'development';

  public init(): void {
    this.postHogClient ??= this.initPostHogClient();
    this.sessionTracker ??= this.initPostHogClient(true);
    this.log.info(`Analytics service initialized (analytics ID: ${this.getDistinctId()}, anonymous tracking consent: ${this.allowedToSendAnalytics()})`);
  }

  public sendEvent(eventName: string, properties?: Record<string | number, any>): void {
    if (this.allowedToSendAnalytics() && this.postHogClient && eventName) {
      const eventProperties = {
        '$session_id': this.sessionId,
        ...properties,
      }
      this.log.info(`event: ${eventName}`, eventProperties);
      this.postHogClient.capture({
        distinctId: this.getDistinctId(),
        event: eventName,
        properties: eventProperties,
      })
    }
  }

  public async optIn(): Promise<void> {
    this.log.info('Processing analytics opt-in');

    this.postHogClient ??= this.initPostHogClient();
    await this.postHogClient?.optIn()

    this.getSettingsStore().set({ analyticsEnabled: true });
    if (!this.getSettingsStore().get("analyticsId")) {
      this.getSettingsStore().set({ analyticsId: `nimbalyst_${ulid()}` });
    }
  }

  public async optOut(): Promise<void> {
    this.log.info('Processing analytics opt-out');

    if (this.postHogClient) {
      await this.postHogClient.captureImmediate({ distinctId: this.getDistinctId(), event: 'analytics_opt_out' });
      await this.postHogClient.optOut()
    }

    this.getSettingsStore().set({ analyticsEnabled: false });
  }

  /**
   * Invoked by the render-side tracker when PostHog generates a new session ID so the electron-side tracker can send
   * the same session ID in its events too. You probably never need to call this yourself.
   */
  public setSessionId(sessionId: string): void {
    this.log.info(`Setting analytics session ID: ${sessionId}, previous session ID: ${this.sessionId}, anonymous tracking consent: ${this.allowedToSendAnalytics()}`);
    this.sessionId = sessionId;

    const eventProperties: Record<string | number, any> = {
      '$session_id': this.sessionId,
      $set: {
        'nimbalyst_version': app.getVersion(),
      }
    };

    if (this.isDevInstallation) {
      eventProperties.$set_once = {
        'is_dev_install': true
      }
    }

    this.sessionTracker?.capture({
      distinctId: this.getDistinctId(),
      event: 'nimbalyst_session_start',
      properties: eventProperties
    })
  }

  public async destroy(): Promise<void> {
    const t0 = Date.now();
    if (this.postHogClient) {
      await this.postHogClient.shutdown();
    }
    const t1 = Date.now();
    this.log.info(`Analytics service shut down in ${t1 - t0}ms`);
  }

  public allowedToSendAnalytics(): boolean {
    const settings = this.getSettingsStore().store;
    return settings.analyticsEnabled && !!settings.analyticsId;
  }

  public getDistinctId(): string {
    return this.distinctId ??= this.getSettingsStore().get('analyticsId');
  }

  private getSettingsStore(): Store<AnalyticsSettings> {
    return this.settingsStore ??= new Store({
      name: 'analytics-settings',
      defaults: {
        analyticsEnabled: true,
        analyticsId: `nimbalyst_${ulid()}`
      }
    });
  }

  private initPostHogClient(forceOptIn?: boolean): PostHog {
    return new PostHog(
      POSTHOG_PROJECT_PUBLIC_ID,
      {
        privacyMode: true,
        defaultOptIn: forceOptIn || this.allowedToSendAnalytics(),
        bootstrap: {
          distinctId: this.getDistinctId()
        },
        disableGeoip: false,
        enableExceptionAutocapture: false,
        before_send: beforePosthogSendNodeJS
      }
    );
  }

}
