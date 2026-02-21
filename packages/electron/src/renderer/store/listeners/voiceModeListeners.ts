/**
 * Centralized Voice Mode IPC Listeners
 *
 * Subscribes to voice-mode IPC events ONCE and updates atoms.
 * Components read from atoms, never subscribe to IPC directly.
 *
 * Voice sessions are persisted incrementally:
 * - Session row created in ai_sessions when voice activates
 * - Each transcript entry written to ai_agent_messages as it arrives
 * - Final metadata (token usage, duration) updated when voice stops
 *
 * Call initVoiceModeListeners() once in AgentMode.tsx on mount.
 */

import { store, activeTabIdAtom, getFilePathFromKey, makeEditorContext } from '@nimbalyst/runtime/store';
import {
  voiceActiveSessionIdAtom,
  voiceTranscriptEntriesAtom,
  voiceCurrentUserTextAtom,
  voiceTokenUsageAtom,
  voiceSessionStartTimeAtom,
  voiceWorkspacePathAtom,
  voiceDbSessionIdAtom,
  voiceLastReportedFileAtom,
  voiceListenStateAtom,
  type VoiceTranscriptEntry,
  type VoiceTokenUsage,
} from '../atoms/voiceModeState';
import { voiceModeSettingsAtom } from '../atoms/appSettings';
import { activeSessionIdAtom, sessionRegistryAtom } from '../atoms/sessions';
import { windowModeAtom } from '../atoms/windowMode';

/**
 * Callback for notifying VoiceModeButton when the linked session changes.
 * VoiceModeButton keeps a module-level activeVoiceSessionId that must stay in sync.
 */
let _onLinkedSessionChanged: ((newSessionId: string) => void) | null = null;

/**
 * Register a callback to be notified when voice follows a session switch.
 * Used by VoiceModeButton to keep its module-level activeVoiceSessionId in sync.
 */
export function onLinkedSessionChanged(callback: ((newSessionId: string) => void) | null): void {
  _onLinkedSessionChanged = callback;
}

// =========================================================================
// Listen Window Timer
// =========================================================================
// Centralized timer that transitions voice from 'listening' to 'sleeping'
// after a configurable period of inactivity. Reset on speech events,
// restarted when the voice agent responds.

let _listenWindowTimer: ReturnType<typeof setTimeout> | null = null;

function getListenWindowMs(): number {
  return store.get(voiceModeSettingsAtom).listenWindowMs ?? 10000;
}

function clearListenWindowTimer(): void {
  if (_listenWindowTimer) {
    clearTimeout(_listenWindowTimer);
    _listenWindowTimer = null;
  }
}

function startListenWindowTimer(): void {
  clearListenWindowTimer();
  const ms = getListenWindowMs();
  _listenWindowTimer = setTimeout(() => {
    _listenWindowTimer = null;
    // Only sleep if still in listening state
    if (store.get(voiceListenStateAtom) === 'listening') {
      sleepVoiceListening();
    }
  }, ms);
}

/**
 * Transition to listening state and start the listen window timer.
 * Call when voice should actively capture audio.
 */
export function wakeVoiceListening(): void {
  const current = store.get(voiceListenStateAtom);
  if (current === 'off') return; // can't wake if not active
  store.set(voiceListenStateAtom, 'listening');
  startListenWindowTimer();
  if (current === 'sleeping') {
    // Tell main process to resume the inactivity disconnect timer
    window.electronAPI.send('voice-mode:listen-state-changed', { sleeping: false });
    writeDiagnosticEntry('Listen window: woke up');
  }
}

/**
 * Transition to sleeping state and stop the listen window timer.
 * Audio capture will be gated in VoiceModeButton.
 * Notifies main process to suspend its inactivity monitor.
 */
export function sleepVoiceListening(): void {
  if (store.get(voiceListenStateAtom) !== 'listening') return;
  clearListenWindowTimer();
  store.set(voiceListenStateAtom, 'sleeping');
  // Tell main process to suspend the inactivity disconnect timer
  const voiceSessionId = store.get(voiceActiveSessionIdAtom);
  if (voiceSessionId) {
    window.electronAPI.send('voice-mode:listen-state-changed', { sleeping: true });
  }
  writeDiagnosticEntry('Listen window: sleeping');
}

/**
 * Reset the listen window timer (user is actively speaking).
 */
function resetListenWindowTimer(): void {
  if (store.get(voiceListenStateAtom) === 'listening') {
    startListenWindowTimer();
  }
}

/**
 * Write a single transcript entry to the database.
 * Fire-and-forget -- errors are logged but don't block the UI.
 */
function writeTranscriptEntry(entry: VoiceTranscriptEntry): void {
  const dbSessionId = store.get(voiceDbSessionIdAtom);
  if (!dbSessionId) return;

  window.electronAPI.invoke('voice-mode:appendMessage', {
    sessionId: dbSessionId,
    direction: entry.role === 'user' ? 'input' : 'output',
    content: entry.text,
    entryId: entry.id,
    timestamp: entry.timestamp,
  }).catch(error => {
    console.error('[voiceModeListeners] Failed to write transcript entry:', error);
  });
}

/**
 * Write a diagnostic/system entry to the voice session for debugging.
 * These use direction 'output' with a special entryId prefix so they
 * can be distinguished from real transcript entries.
 */
function writeDiagnosticEntry(message: string): void {
  const dbSessionId = store.get(voiceDbSessionIdAtom);
  if (!dbSessionId) return;

  window.electronAPI.invoke('voice-mode:appendMessage', {
    sessionId: dbSessionId,
    direction: 'output',
    content: `[system] ${message}`,
    entryId: `diag-${Date.now()}`,
    timestamp: Date.now(),
  }).catch(error => {
    console.error('[voiceModeListeners] Failed to write diagnostic entry:', error);
  });
}

/**
 * Update voice session metadata in the database (token usage, duration).
 */
async function updateSessionMetadata(tokenUsage?: VoiceTokenUsage | null): Promise<void> {
  const dbSessionId = store.get(voiceDbSessionIdAtom);
  if (!dbSessionId) return;

  const finalTokenUsage = tokenUsage || store.get(voiceTokenUsageAtom);
  const startTime = store.get(voiceSessionStartTimeAtom);
  const durationMs = startTime ? Date.now() - startTime : 0;

  try {
    await window.electronAPI.invoke('voice-mode:updateSessionMetadata', {
      sessionId: dbSessionId,
      tokenUsage: finalTokenUsage,
      durationMs,
    });
  } catch (error) {
    console.error('[voiceModeListeners] Failed to update voice session metadata:', error);
  }
}

/**
 * Reset all voice state atoms.
 */
function resetVoiceAtoms(): void {
  clearListenWindowTimer();
  store.set(voiceListenStateAtom, 'off');
  store.set(voiceActiveSessionIdAtom, null);
  store.set(voiceTranscriptEntriesAtom, []);
  store.set(voiceCurrentUserTextAtom, '');
  store.set(voiceTokenUsageAtom, null);
  store.set(voiceSessionStartTimeAtom, null);
  store.set(voiceWorkspacePathAtom, null);
  store.set(voiceDbSessionIdAtom, null);
  store.set(voiceLastReportedFileAtom, null);
}

/**
 * Initialize voice mode IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to call on unmount
 */
export function initVoiceModeListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // Helper: check whether voice is active. Voice is a singleton so we don't
  // need to compare session IDs -- just check that *any* voice session is running.
  const isVoiceActive = () => store.get(voiceActiveSessionIdAtom) !== null;

  // =========================================================================
  // Transcript Complete (user finished speaking)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('voice-mode:transcript-complete', (payload: {
      sessionId: string;
      transcript: string;
    }) => {
      if (!isVoiceActive()) return;
      if (!payload.transcript || payload.transcript.trim() === '') return;

      // User spoke -- reset listen window timer
      resetListenWindowTimer();

      // Clear partial text
      store.set(voiceCurrentUserTextAtom, '');

      // Append completed user entry
      const entries = store.get(voiceTranscriptEntriesAtom);
      const entry: VoiceTranscriptEntry = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: payload.transcript.trim(),
        timestamp: Date.now(),
      };
      store.set(voiceTranscriptEntriesAtom, [...entries, entry]);

      // Write to DB immediately
      writeTranscriptEntry(entry);
    })
  );

  // =========================================================================
  // Transcript Delta (streaming partial transcription while user speaks)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('voice-mode:transcript-delta', (payload: {
      sessionId: string;
      delta: string;
      itemId: string;
    }) => {
      if (!isVoiceActive()) return;

      // User is speaking -- reset listen window timer
      resetListenWindowTimer();

      store.set(voiceCurrentUserTextAtom, payload.delta);
    })
  );

  // =========================================================================
  // Text Received (assistant response text deltas)
  // =========================================================================
  // Track the last assistant entry ID so we can update it in-place in the atom
  // but only write to DB once when the entry is "complete" (next user turn or stop).
  // Actually, we write each new assistant entry to DB when it starts,
  // then update its content as deltas arrive. But writing every delta is too much.
  // Instead: write assistant entries on response.done or when the next user speaks.
  let pendingAssistantEntry: VoiceTranscriptEntry | null = null;

  cleanups.push(
    window.electronAPI.on('voice-mode:text-received', (payload: {
      sessionId: string;
      text: string;
    }) => {
      if (!isVoiceActive()) return;

      // Assistant is responding -- wake up if sleeping so user can reply
      if (store.get(voiceListenStateAtom) === 'sleeping') {
        wakeVoiceListening();
      }

      const entries = store.get(voiceTranscriptEntriesAtom);
      const lastEntry = entries[entries.length - 1];

      if (lastEntry && lastEntry.role === 'assistant') {
        // Append to existing assistant entry
        const updated = entries.map((e, i) =>
          i === entries.length - 1
            ? { ...e, text: e.text + payload.text, timestamp: Date.now() }
            : e
        );
        store.set(voiceTranscriptEntriesAtom, updated);
        // Update pending entry for batch write
        pendingAssistantEntry = updated[updated.length - 1];
      } else {
        // Flush any previous pending assistant entry
        if (pendingAssistantEntry) {
          writeTranscriptEntry(pendingAssistantEntry);
          pendingAssistantEntry = null;
        }
        // Start new assistant entry
        const entry: VoiceTranscriptEntry = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: payload.text,
          timestamp: Date.now(),
        };
        store.set(voiceTranscriptEntriesAtom, [...entries, entry]);
        pendingAssistantEntry = entry;
      }
    })
  );

  // =========================================================================
  // Token Usage -- also flush pending assistant entry
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('voice-mode:token-usage', (payload: {
      sessionId: string;
      usage: VoiceTokenUsage;
    }) => {
      if (!isVoiceActive()) return;

      store.set(voiceTokenUsageAtom, payload.usage);

      // Token usage arrives after response.done, so flush the assistant entry
      if (pendingAssistantEntry) {
        writeTranscriptEntry(pendingAssistantEntry);
        pendingAssistantEntry = null;
      }
    })
  );

  // =========================================================================
  // Voice Session Stopped (update metadata, reset state)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('voice-mode:stopped', async (payload: {
      sessionId: string;
      tokenUsage?: VoiceTokenUsage;
    }) => {
      if (!isVoiceActive()) return;

      // Flush any pending assistant entry
      if (pendingAssistantEntry) {
        writeTranscriptEntry(pendingAssistantEntry);
        pendingAssistantEntry = null;
      }

      // Write stop diagnostic before clearing state
      const startTime = store.get(voiceSessionStartTimeAtom);
      const durationSec = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
      writeDiagnosticEntry(`Voice stopped (duration: ${durationSec}s)`);

      // Update final metadata
      await updateSessionMetadata(payload.tokenUsage);

      // Reset atoms
      resetVoiceAtoms();
    })
  );

  // =========================================================================
  // Pause Listening (voice agent tool or programmatic)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('voice-mode:pause-listening', (_payload: {
      sessionId: string;
    }) => {
      if (!isVoiceActive()) return;
      sleepVoiceListening();
    })
  );

  // =========================================================================
  // Editor Context Tracking (active file -> voice agent)
  // =========================================================================
  // When voice is active, track which file the user is viewing and notify
  // the main process so the voice agent knows what document is open.
  // This is pure Jotai -- no React state involved.

  function getCurrentFilePath(): string | null {
    const mode = store.get(windowModeAtom);

    if (mode === 'files') {
      const activeTabKey = store.get(activeTabIdAtom('main'));
      return activeTabKey ? getFilePathFromKey(activeTabKey) : null;
    }

    if (mode === 'agent') {
      const sessionId = store.get(activeSessionIdAtom);
      if (!sessionId) return null;
      const context = makeEditorContext(sessionId);
      const activeTabKey = store.get(activeTabIdAtom(context));
      return activeTabKey ? getFilePathFromKey(activeTabKey) : null;
    }

    return null;
  }

  let editorContextDebounce: ReturnType<typeof setTimeout> | null = null;
  function checkAndReportFileChange(): void {
    const voiceSessionId = store.get(voiceActiveSessionIdAtom);
    if (!voiceSessionId) return;

    if (editorContextDebounce) clearTimeout(editorContextDebounce);
    editorContextDebounce = setTimeout(() => {
      const currentFile = getCurrentFilePath();
      const lastReported = store.get(voiceLastReportedFileAtom);

      if (currentFile !== lastReported) {
        store.set(voiceLastReportedFileAtom, currentFile);
        window.electronAPI.send('voice-mode:editor-context-changed', {
          sessionId: voiceSessionId,
          filePath: currentFile,
        });

        const shortPrev = lastReported ? lastReported.split('/').pop() : '(none)';
        const shortCurr = currentFile ? currentFile.split('/').pop() : '(none)';
        writeDiagnosticEntry(`File changed: ${shortPrev} -> ${shortCurr}`);
      }
    }, 300);
  }

  // =========================================================================
  // Session Switch Tracking (voice follows the active coding session)
  // =========================================================================
  // When the user switches coding sessions while voice is active,
  // update the linked session so voice commands go to the right place.
  function syncLinkedSession(): void {
    const voiceSessionId = store.get(voiceActiveSessionIdAtom);
    if (!voiceSessionId) return; // voice not active

    const newSessionId = store.get(activeSessionIdAtom);
    if (!newSessionId || newSessionId === voiceSessionId) return;

    // Update the atom so renderer-side filtering matches
    store.set(voiceActiveSessionIdAtom, newSessionId);

    // Look up the session name for the voice agent
    const registry = store.get(sessionRegistryAtom);
    const sessionMeta = registry.get(newSessionId);
    const sessionName = sessionMeta?.title || 'Untitled';

    // Notify main process so voice agent callbacks target the new session
    window.electronAPI.send('voice-mode:update-linked-session', {
      newSessionId,
      sessionName,
    });

    // Notify VoiceModeButton's module-level variable
    if (_onLinkedSessionChanged) {
      _onLinkedSessionChanged(newSessionId);
    }

    console.log(`[voiceModeListeners] Voice session followed active session switch -> "${sessionName}"`);
    writeDiagnosticEntry(`Switched linked session to "${sessionName}"`);
  }
  cleanups.push(store.sub(activeSessionIdAtom, syncLinkedSession));

  cleanups.push(store.sub(activeTabIdAtom('main'), checkAndReportFileChange));
  cleanups.push(store.sub(activeSessionIdAtom, checkAndReportFileChange));
  cleanups.push(store.sub(windowModeAtom, checkAndReportFileChange));
  cleanups.push(store.sub(voiceActiveSessionIdAtom, checkAndReportFileChange));

  let sessionTabUnsub: (() => void) | null = null;
  function updateSessionTabSubscription(): void {
    if (sessionTabUnsub) {
      sessionTabUnsub();
      sessionTabUnsub = null;
    }
    const sessionId = store.get(activeSessionIdAtom);
    if (!sessionId) return;
    const context = makeEditorContext(sessionId);
    sessionTabUnsub = store.sub(activeTabIdAtom(context), checkAndReportFileChange);
  }
  updateSessionTabSubscription();
  cleanups.push(store.sub(activeSessionIdAtom, updateSessionTabSubscription));
  cleanups.push(() => {
    if (sessionTabUnsub) {
      sessionTabUnsub();
      sessionTabUnsub = null;
    }
    if (editorContextDebounce) {
      clearTimeout(editorContextDebounce);
    }
    clearListenWindowTimer();
  });

  return () => {
    cleanups.forEach(fn => fn?.());
  };
}

/** How long before a voice session is considered "expired" and a new one is created */
const VOICE_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Set the active voice session ID and create or resume the DB session row.
 *
 * If a recent voice session exists for this workspace (updated within the
 * timeout window), we resume it so transcript entries continue appending
 * to the same session. Otherwise we create a new one.
 *
 * Called when a voice session starts (from VoiceModeButton).
 */
export async function setVoiceActiveSession(sessionId: string, workspacePath?: string | null): Promise<void> {
  // Set atoms immediately so the UI reflects active state
  store.set(voiceActiveSessionIdAtom, sessionId);
  store.set(voiceListenStateAtom, 'listening');
  store.set(voiceTranscriptEntriesAtom, []);
  store.set(voiceCurrentUserTextAtom, '');
  store.set(voiceTokenUsageAtom, null);
  store.set(voiceSessionStartTimeAtom, Date.now());
  store.set(voiceWorkspacePathAtom, workspacePath || null);
  store.set(voiceLastReportedFileAtom, null);

  // Start the listen window timer
  startListenWindowTimer();

  // Try to find and resume a recent voice session
  const wp = workspacePath || '';
  try {
    const result = await window.electronAPI.invoke('voice-mode:findRecentSession', {
      workspacePath: wp,
      timeoutMs: VOICE_SESSION_TIMEOUT_MS,
    }) as { found: boolean; sessionId?: string };

    if (result.found && result.sessionId) {
      // Resume existing session
      store.set(voiceDbSessionIdAtom, result.sessionId);
      window.electronAPI.invoke('voice-mode:resumeSession', {
        sessionId: result.sessionId,
        linkedSessionId: sessionId,
      }).catch(error => {
        console.error('[voiceModeListeners] Failed to resume voice session:', error);
      });
      console.log('[voiceModeListeners] Resumed voice session:', result.sessionId);
      writeDiagnosticEntry(`Resumed voice session (linked to ${sessionId.slice(0, 8)}...)`);
      return;
    }
  } catch (error) {
    console.error('[voiceModeListeners] Failed to check for recent session:', error);
  }

  // No recent session -- create a new one
  const dbSessionId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.set(voiceDbSessionIdAtom, dbSessionId);

  window.electronAPI.invoke('voice-mode:createSession', {
    id: dbSessionId,
    workspacePath: wp,
    linkedSessionId: sessionId,
  }).catch(error => {
    console.error('[voiceModeListeners] Failed to create voice session in DB:', error);
  });
  console.log('[voiceModeListeners] Created new voice session:', dbSessionId);
  writeDiagnosticEntry(`New voice session created (linked to ${sessionId.slice(0, 8)}...)`);
}

/**
 * Persist final metadata and clear voice session state.
 * Called when a voice session is stopped by the user (not via voice-mode:stopped IPC).
 */
export async function persistAndClearVoiceSession(
  _sessionId: string,
  tokenUsage?: VoiceTokenUsage | null,
): Promise<void> {
  await updateSessionMetadata(tokenUsage);
  resetVoiceAtoms();
}

/**
 * Clear the active voice session without persisting.
 * Used for error paths and cleanup where no persistence is needed.
 */
export function clearVoiceActiveSession(): void {
  resetVoiceAtoms();
}
