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
  private isOfficialBuild: boolean = process.env.OFFICIAL_BUILD === 'true';

  public init(): void {
    this.postHogClient ??= this.initPostHogClient();
    this.sessionTracker ??= this.initPostHogClient();
    this.log.info(`Analytics service initialized (analytics ID: ${this.getDistinctId()}, official build: ${this.isOfficialBuild})`);
  }

  public sendEvent(eventName: string, properties?: Record<string | number, any>): void {
    if (this.allowedToSendAnalytics() && this.postHogClient && eventName) {
      const eventProperties: Record<string | number, any> = {
        '$session_id': this.sessionId,
        ...properties,
      }

      // Mark users as dev users if they've ever used a non-official build
      // This ensures the property is set even if they missed the session start event
      if (!this.isOfficialBuild) {
        eventProperties.$set_once = {
          'is_dev_user': true,
          ...eventProperties.$set_once
        }
      }

      // this.log.info(`event: ${eventName}`, eventProperties);
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
    this.log.info(`Setting analytics session ID: ${sessionId}, previous session ID: ${this.sessionId}, official build: ${this.isOfficialBuild}`);
    this.sessionId = sessionId;

    if (!this.allowedToSendAnalytics()) {
      this.log.info('Skipping session start event (analytics disabled)');
      return;
    }

    const eventProperties: Record<string | number, any> = {
      '$session_id': this.sessionId,
      $set: {
        'nimbalyst_version': app.getVersion(),
      }
    };

    // Mark users as dev users if they've ever used a non-official build
    // This uses $set_once which only sets the property if it doesn't already exist
    // Once someone is marked as a dev user, they remain marked even on official builds
    if (!this.isOfficialBuild) {
      eventProperties.$set_once = {
        'is_dev_user': true
      }
    }

    // Also track whether this is a dev installation (NODE_ENV=development)
    if (this.isDevInstallation) {
      eventProperties.$set_once = {
        ...eventProperties.$set_once,
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
    // Send analytics from all builds (dev and official)
    // Users are marked with 'is_dev_user' property if they've ever used a non-official build
    // This allows filtering dev users in PostHog while still collecting their data
    return true;
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

  private initPostHogClient(): PostHog {
    return new PostHog(
      POSTHOG_PROJECT_PUBLIC_ID,
      {
        privacyMode: true,
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
