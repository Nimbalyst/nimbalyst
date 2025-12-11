/**
 * Register the Extension System with its Electron-specific platform service.
 *
 * This sets up the ExtensionPlatformService implementation that provides
 * the Electron-specific functionality for loading extensions, and
 * initializes the extension loader.
 */

import {
  setExtensionPlatformService,
  initializeExtensions,
} from '@nimbalyst/runtime';
import { ExtensionPlatformServiceImpl } from '../services/ExtensionPlatformServiceImpl';
import { initializeExtensionEditorBridge } from '../extensions/ExtensionEditorBridge';

/**
 * Register the Extension System with its platform service.
 * Should be called once during app initialization.
 *
 * This is an async function because extension discovery and loading
 * involves file system operations.
 */
export async function registerExtensionSystem(): Promise<void> {
  // Set up the platform service
  const service = ExtensionPlatformServiceImpl.getInstance();
  setExtensionPlatformService(service);

  // Discover and load extensions
  // This will scan the extensions directory and load any valid extensions
  try {
    await initializeExtensions();

    // Initialize the bridge to register custom editors from extensions
    initializeExtensionEditorBridge();
  } catch (error) {
    console.error('[ExtensionSystem] Failed to initialize extensions:', error);
    // Don't throw - extensions failing shouldn't prevent the app from starting
  }
}
