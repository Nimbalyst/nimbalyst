import type { BrowserWindow } from 'electron';
import type { WindowState } from '../types';

// Shared window maps used across main-process modules.
// Keeping these in a lightweight module avoids importing WindowManager
// (and its transitive startup dependencies) where only map access is needed.
export const windows = new Map<number, BrowserWindow>();
export const windowStates = new Map<number, WindowState>();
