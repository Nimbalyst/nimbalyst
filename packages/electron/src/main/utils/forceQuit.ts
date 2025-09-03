import { app, BrowserWindow } from 'electron';
import { appendFileSync } from 'fs';
import { join } from 'path';

let forceQuitTimer: NodeJS.Timeout | null = null;
let isForceQuitting = false;

function logToDebugFile(message: string) {
    try {
        const debugLog = join(app.getPath('userData'), 'stravu-editor-debug.log');
        appendFileSync(debugLog, `[QUIT] ${new Date().toISOString()} - ${message}\n`);
    } catch (e) {
        // Ignore logging errors
    }
}

export function setupForceQuit(delay: number = 2000) {
    if (isForceQuitting) {
        return; // Already force quitting
    }
    
    logToDebugFile(`Setting up force quit timer for ${delay}ms`);
    
    forceQuitTimer = setTimeout(() => {
        isForceQuitting = true;
        logToDebugFile('=== FORCE QUIT TIMER FIRED ===');
        
        try {
            // Force destroy all windows
            const windows = BrowserWindow.getAllWindows();
            logToDebugFile(`Force destroying ${windows.length} windows`);
            windows.forEach((win, i) => {
                try {
                    if (!win.isDestroyed()) {
                        win.destroy();
                        logToDebugFile(`  Destroyed window ${i}: ${win.getTitle()}`);
                    }
                } catch (e) {
                    logToDebugFile(`  Failed to destroy window ${i}: ${e}`);
                }
            });
            
            // Log active handles for debugging
            const activeHandles = (process as any)._getActiveHandles?.();
            const activeRequests = (process as any)._getActiveRequests?.();
            
            if (activeHandles) {
                logToDebugFile(`Active handles: ${activeHandles.length}`);
                activeHandles.forEach((handle: any, i: number) => {
                    const name = handle.constructor.name;
                    // Log more details for certain handle types
                    if (name === 'Server' || name === 'Socket' || name === 'TCP') {
                        logToDebugFile(`  Handle ${i}: ${name} (address: ${handle.address?.()})`);
                        // Force close servers
                        if (typeof handle.close === 'function') {
                            try {
                                handle.close();
                                logToDebugFile(`    Closed ${name} handle`);
                            } catch (e) {
                                logToDebugFile(`    Failed to close ${name}: ${e}`);
                            }
                        }
                        // Unref to not keep process alive
                        if (typeof handle.unref === 'function') {
                            handle.unref();
                        }
                    } else {
                        logToDebugFile(`  Handle ${i}: ${name}`);
                    }
                });
            }
            
            if (activeRequests) {
                logToDebugFile(`Active requests: ${activeRequests.length}`);
            }
            
        } catch (e) {
            logToDebugFile(`Error during force quit cleanup: ${e}`);
        }
        
        // Multiple escalating attempts to quit
        logToDebugFile('Attempting app.exit(0)');
        try {
            app.exit(0);
        } catch (e) {
            logToDebugFile(`app.exit failed: ${e}`);
        }
        
        // If still alive after 500ms, try process.exit
        setTimeout(() => {
            if (!isForceQuitting) return;
            logToDebugFile('Still alive, attempting process.exit(0)');
            try {
                process.exit(0);
            } catch (e) {
                logToDebugFile(`process.exit failed: ${e}`);
            }
            
            // Nuclear option after another 500ms
            setTimeout(() => {
                if (!isForceQuitting) return;
                logToDebugFile('Still alive, sending SIGKILL');
                try {
                    process.kill(process.pid, 'SIGKILL');
                } catch (e) {
                    logToDebugFile(`SIGKILL failed: ${e}`);
                }
            }, 500);
        }, 500);
        
    }, delay);
    
    // Set up listener to cancel timer if we quit normally
    app.once('will-quit', () => {
        logToDebugFile('will-quit event - canceling force quit timer');
        cancelForceQuit();
    });
}

export function cancelForceQuit() {
    if (forceQuitTimer) {
        clearTimeout(forceQuitTimer);
        forceQuitTimer = null;
        isForceQuitting = false;
        logToDebugFile('Force quit timer canceled');
    }
}