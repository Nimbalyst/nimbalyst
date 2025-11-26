/**
 * Custom Editor Registry
 *
 * Manages registration and lookup of custom editor components for specific file types.
 * This allows extending the editor system without modifying TabEditor.tsx.
 */

import type { CustomEditorComponent, CustomEditorRegistration } from './types';
import { logger } from '../../utils/logger';

class CustomEditorRegistry {
  private registrations: Map<string, CustomEditorRegistration> = new Map();

  /**
   * Register a custom editor for one or more file extensions
   */
  register(registration: CustomEditorRegistration): void {
    const { extensions, component, name } = registration;

    if (!extensions || extensions.length === 0) {
      logger.ui.warn('[CustomEditorRegistry] Attempted to register editor without extensions');
      return;
    }

    if (!component) {
      logger.ui.warn('[CustomEditorRegistry] Attempted to register editor without component');
      return;
    }

    // Register each extension
    for (const ext of extensions) {
      const normalizedExt = ext.toLowerCase();

      // Check for conflicts
      if (this.registrations.has(normalizedExt)) {
        const existing = this.registrations.get(normalizedExt);
        logger.ui.warn(
          `[CustomEditorRegistry] Extension ${ext} is already registered by ${existing?.name || 'unknown'}. Overwriting.`
        );
      }

      this.registrations.set(normalizedExt, registration);
      logger.ui.info(
        `[CustomEditorRegistry] Registered ${name || 'custom editor'} for extension ${ext}`
      );
    }
  }

  /**
   * Get the custom editor component for a file extension
   * Returns undefined if no custom editor is registered for this extension
   */
  getEditor(extension: string): CustomEditorComponent | undefined {
    const normalizedExt = extension.toLowerCase();
    const registration = this.registrations.get(normalizedExt);
    return registration?.component;
  }

  /**
   * Check if a custom editor is registered for a file extension
   */
  hasEditor(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return this.registrations.has(normalizedExt);
  }

  /**
   * Get the full registration info for a file extension
   */
  getRegistration(extension: string): CustomEditorRegistration | undefined {
    const normalizedExt = extension.toLowerCase();
    return this.registrations.get(normalizedExt);
  }

  /**
   * Unregister a custom editor for specific extensions
   */
  unregister(extensions: string[]): void {
    for (const ext of extensions) {
      const normalizedExt = ext.toLowerCase();
      const registration = this.registrations.get(normalizedExt);
      if (registration) {
        this.registrations.delete(normalizedExt);
        logger.ui.info(
          `[CustomEditorRegistry] Unregistered ${registration.name || 'custom editor'} for extension ${ext}`
        );
      }
    }
  }

  /**
   * Get all registered extensions
   */
  getRegisteredExtensions(): string[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.registrations.clear();
    logger.ui.info('[CustomEditorRegistry] Cleared all custom editor registrations');
  }
}

// Singleton instance
export const customEditorRegistry = new CustomEditorRegistry();
