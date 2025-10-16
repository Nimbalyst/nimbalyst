import Store from "electron-store";
import {PostHog} from "posthog-node";
import {ulid} from "ulid";
import {logger} from "../../utils/logger.ts";

const POSTHOG_PROJECT_PUBLIC_ID = 'phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw';

type AnalyticsSettings = {
  analyticsEnabled: boolean;
  analyticsId: string;
}

/**
 * Singleton analytics service
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
  private distinctId?: string;

  public init(): void {
    this.postHogClient ??= this.initPostHogClient();
    this.log.info(`Analytics service initialized (analytics ID: ${this.getDistinctId()})`);
    this.log.info(`Analytics allowed: ${this.allowedToSendAnalytics()}`)
  }

  public sendEvent(eventName: string, properties?: Record<string | number, any>): void {
    if (this.allowedToSendAnalytics() && this.postHogClient && eventName) {
      this.log.debug(`event: ${eventName}`, properties || {});
      this.postHogClient.capture({
        distinctId: this.getDistinctId(),
        event: eventName,
        properties: properties,
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

    this.sendEvent('analytics_opt_in');
  }

  public async optOut(): Promise<void> {
    this.log.info('Processing analytics opt-out');

    if (this.postHogClient) {
      await this.postHogClient.captureImmediate({ distinctId: this.getDistinctId(), event: 'analytics_opt_out' });
      await this.postHogClient.optOut()
    }

    this.getSettingsStore().set({ analyticsEnabled: false });
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

  private initPostHogClient(): PostHog {
    return new PostHog(
      POSTHOG_PROJECT_PUBLIC_ID,
      {
        privacyMode: true,
        defaultOptIn: this.allowedToSendAnalytics(),
        bootstrap: {
          distinctId: this.getDistinctId()
        }
      }
    );
  }

}
