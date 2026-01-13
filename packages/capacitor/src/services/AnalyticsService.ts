import posthog from 'posthog-js';
import { ulid } from 'ulid';
import { Preferences } from '@capacitor/preferences';

const POSTHOG_KEY = 'phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw';
const ANALYTICS_ID_KEY = 'analytics_distinct_id';
const ANALYTICS_ENABLED_KEY = 'analytics_enabled';

/**
 * Mobile analytics service for PostHog tracking.
 *
 * Privacy approach:
 * - Anonymous distinctId (or shared with desktop via QR pairing)
 * - Minimal event data (no session content, project names, or file paths)
 * - Opt-out support
 * - Email only set if user authenticates via Stytch
 */
class MobileAnalyticsService {
  private initialized = false;
  private distinctId: string | null = null;
  private enabled = true;

  async init(): Promise<void> {
    if (this.initialized) return;

    // Load stored ID (may be from QR pairing or self-generated)
    const { value: storedId } = await Preferences.get({ key: ANALYTICS_ID_KEY });
    if (storedId) {
      this.distinctId = storedId;
    } else {
      // Generate temporary ID until QR pairing provides desktop's ID
      this.distinctId = `nimbalyst_mobile_${ulid()}`;
      await Preferences.set({ key: ANALYTICS_ID_KEY, value: this.distinctId });
    }

    // Load opt-out preference
    const { value: enabledStr } = await Preferences.get({ key: ANALYTICS_ENABLED_KEY });
    this.enabled = enabledStr !== 'false';

    // Initialize PostHog with privacy settings
    posthog.init(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      bootstrap: { distinctID: this.distinctId },
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      persistence: 'memory', // Don't persist tracking data in localStorage
    });

    // Mark dev users
    if (import.meta.env.DEV) {
      posthog.people.set_once({ is_dev_user: true });
    }

    if (!this.enabled) {
      posthog.opt_out_capturing();
    }

    this.initialized = true;
  }

  /**
   * Called after QR pairing to adopt desktop's analytics ID.
   * This links mobile and desktop events to the same user in PostHog.
   */
  async setDistinctIdFromPairing(analyticsId: string): Promise<void> {
    if (!analyticsId) return;

    this.distinctId = analyticsId;
    await Preferences.set({ key: ANALYTICS_ID_KEY, value: analyticsId });

    // Re-identify with the desktop's ID
    posthog.identify(analyticsId);
  }

  /**
   * Called after Stytch login to set email on PostHog profile.
   * This provides secondary correlation between devices.
   */
  setEmail(email: string): void {
    if (!email || !this.initialized) return;
    posthog.people.set({ email });
  }

  /**
   * Capture an analytics event.
   */
  capture(event: string, properties?: Record<string, unknown>): void {
    if (!this.initialized || !this.enabled) return;
    posthog.capture(event, properties);
  }

  /**
   * Opt out of analytics tracking.
   */
  async optOut(): Promise<void> {
    // Send opt-out event before disabling
    this.capture('mobile_analytics_opt_out');
    posthog.opt_out_capturing();
    this.enabled = false;
    await Preferences.set({ key: ANALYTICS_ENABLED_KEY, value: 'false' });
  }

  /**
   * Opt back in to analytics tracking.
   */
  async optIn(): Promise<void> {
    posthog.opt_in_capturing();
    this.enabled = true;
    await Preferences.set({ key: ANALYTICS_ENABLED_KEY, value: 'true' });
  }

  /**
   * Check if analytics is currently enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

export const analyticsService = new MobileAnalyticsService();
