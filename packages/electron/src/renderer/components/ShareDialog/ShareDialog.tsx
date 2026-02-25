import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  addSessionShareAtom,
  sessionShareAtom,
  shareKeysAtom,
  buildShareUrl,
} from '../../store/atoms/sessionShares';

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contentType: 'session' | 'file';
  sessionId?: string;
  filePath?: string;
  title?: string;
}

type ExpirationOption = {
  label: string;
  value: number;
};

const EXPIRATION_OPTIONS: ExpirationOption[] = [
  { label: '1 day', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
];

type ShareState = 'ready' | 'sharing' | 'success' | 'error';

export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  contentType,
  sessionId,
  filePath,
  title,
}) => {
  const [shareState, setShareState] = useState<ShareState>('ready');
  const [errorMessage, setErrorMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [expirationDays, setExpirationDays] = useState<number>(7);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null); // null = loading
  const [authEmail, setAuthEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Check if session is already shared
  const existingShare = useAtomValue(sessionShareAtom(sessionId ?? ''));
  const shareKeys = useAtomValue(shareKeysAtom);
  const addShare = useSetAtom(addSessionShareAtom);

  // Check auth state when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const state = await window.electronAPI?.stytch?.getAuthState();
        setIsAuthenticated(state?.isAuthenticated ?? false);
      } catch {
        setIsAuthenticated(false);
      }
    })();

    // Listen for auth state changes (e.g. magic link completed in browser)
    const unsubscribe = window.electronAPI?.stytch?.onAuthStateChange?.((state: { isAuthenticated: boolean }) => {
      setIsAuthenticated(state.isAuthenticated);
      if (state.isAuthenticated) {
        // Reset auth form state on successful sign-in
        setAuthError(null);
        setMagicLinkSent(false);
        setAuthEmail('');
      }
    });
    window.electronAPI?.stytch?.subscribeAuthState?.();

    return unsubscribe;
  }, [isOpen]);

  // Load saved expiration preference
  useEffect(() => {
    if (!isOpen || preferenceLoaded) return;
    (async () => {
      try {
        const pref = await window.electronAPI?.getShareExpirationPreference?.();
        if (pref !== undefined && pref !== null) {
          setExpirationDays(pref);
        }
      } catch {
        // Use default
      }
      setPreferenceLoaded(true);
    })();
  }, [isOpen, preferenceLoaded]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setShareState('ready');
      setErrorMessage('');
      setShareUrl('');
      setUrlCopied(false);
      setAuthError(null);
      setMagicLinkSent(false);
      setAuthEmail('');

      // If already shared, show the existing URL
      if (existingShare) {
        const key = shareKeys.get(sessionId ?? '');
        const url = buildShareUrl(existingShare.shareId, key);
        setShareUrl(url);
      }
    } else {
      setPreferenceLoaded(false);
    }
  }, [isOpen, existingShare, shareKeys, sessionId]);

  const handleShare = useCallback(async () => {
    setShareState('sharing');
    setErrorMessage('');

    // Save preference
    try {
      await window.electronAPI?.setShareExpirationPreference?.(expirationDays);
    } catch {
      // Non-critical
    }

    try {
      let result: { success: boolean; url?: string; shareId?: string; isUpdate?: boolean; encryptionKey?: string; error?: string } | undefined;

      if (contentType === 'session' && sessionId) {
        result = await window.electronAPI?.shareSessionAsLink({
          sessionId,
          expirationDays,
        });
      } else if (contentType === 'file' && filePath) {
        result = await window.electronAPI?.shareFileAsLink({
          filePath,
          expirationDays,
        });
      }

      if (result?.success && result.url) {
        setShareUrl(result.url);
        setShareState('success');

        // Copy to clipboard
        await navigator.clipboard.writeText(result.url);

        // Update share atoms for sessions
        if (contentType === 'session' && sessionId && result.shareId) {
          const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString();
          addShare({
            shareId: result.shareId,
            sessionId,
            title: title ?? 'Untitled',
            sizeBytes: 0,
            createdAt: new Date().toISOString(),
            expiresAt,
            viewCount: 0,
            encryptionKey: result.encryptionKey,
          });
        }
      } else {
        setErrorMessage(result?.error ?? 'Failed to share');
        setShareState('error');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred');
      setShareState('error');
    }
  }, [contentType, sessionId, filePath, expirationDays, title, addShare]);

  const handleCopyUrl = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  }, [shareUrl]);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await window.electronAPI?.stytch?.signInWithGoogle();
      if (!result?.success && result?.error) {
        setAuthError(result.error);
      }
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleSendMagicLink = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail) {
      setAuthError('Email is required');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = await window.electronAPI?.stytch?.sendMagicLink(authEmail);
      if (!result?.success && result?.error) {
        setAuthError(result.error);
      } else {
        setMagicLinkSent(true);
      }
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthLoading(false);
    }
  }, [authEmail]);

  if (!isOpen) return null;

  const contentLabel = contentType === 'session' ? 'session' : 'file';
  const isAlreadyShared = !!existingShare;
  const isStytchAvailable = !!window.electronAPI?.stytch;
  const needsAuth = isAuthenticated === false;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[10000] bg-black/60 animate-[nim-fade-in_0.2s_ease-out]"
      onClick={onClose}
    >
      <div
        className="relative p-0 w-[420px] max-w-[90vw] rounded-2xl overflow-hidden border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-[nim-slide-up_0.3s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 w-8 h-8 p-0 flex items-center justify-center bg-transparent border-none text-[28px] leading-none cursor-pointer rounded-md z-[1] text-[var(--nim-text-muted)] transition-[color,transform] duration-200 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] hover:scale-110"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>

        <div className="px-8 pt-8 pb-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--nim-primary)]/15 text-[var(--nim-primary)]">
              <MaterialSymbol icon="share" size={22} />
            </div>
            <h2 className="m-0 text-lg font-semibold text-[var(--nim-text)]">
              Share {contentLabel}
            </h2>
          </div>

          {/* Sign-in required */}
          {needsAuth ? (
            <div>
              <p className="m-0 mb-4 text-[0.8125rem] text-[var(--nim-text-muted)]">
                Sign in to share encrypted links.
              </p>

              {magicLinkSent ? (
                <div className="text-center p-4 rounded-lg bg-[var(--nim-bg-hover)]">
                  <MaterialSymbol icon="mail" size={32} className="text-[var(--nim-primary)] mb-2" />
                  <p className="m-0 mb-1 text-[0.8125rem] font-medium text-[var(--nim-text)]">
                    Check your email
                  </p>
                  <p className="m-0 mb-4 text-[0.75rem] text-[var(--nim-text-muted)]">
                    We sent a sign-in link to <strong>{authEmail}</strong>
                  </p>
                  <button
                    onClick={() => {
                      setMagicLinkSent(false);
                      setAuthEmail('');
                    }}
                    className="px-4 py-2 rounded-lg border border-[var(--nim-border)] bg-transparent text-[0.8125rem] text-[var(--nim-text-muted)] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
                  >
                    Back
                  </button>
                </div>
              ) : (
                <>
                  {/* Google Sign In */}
                  <button
                    onClick={handleGoogleSignIn}
                    disabled={authLoading || !isStytchAvailable}
                    className="w-full px-4 py-2.5 flex items-center justify-center gap-2.5 bg-white border border-[var(--nim-border)] rounded-lg text-[#333] font-medium text-[0.8125rem] cursor-pointer disabled:opacity-70 disabled:cursor-wait"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                  </button>

                  <div className="flex items-center gap-3 my-4 text-[var(--nim-text-faint)] text-[0.75rem]">
                    <div className="flex-1 h-px bg-[var(--nim-border)]" />
                    or
                    <div className="flex-1 h-px bg-[var(--nim-border)]" />
                  </div>

                  {/* Email Magic Link */}
                  <form onSubmit={handleSendMagicLink}>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="Enter your email"
                      disabled={!isStytchAvailable || authLoading}
                      className="w-full px-3 py-2 mb-3 text-[0.8125rem] rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)]"
                    />
                    <button
                      type="submit"
                      disabled={authLoading || !isStytchAvailable || !authEmail}
                      className="w-full px-4 py-2.5 rounded-lg border-none text-[0.8125rem] font-medium text-white bg-[var(--nim-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      {authLoading ? 'Sending...' : 'Send sign-in link'}
                    </button>
                  </form>

                  {authError && (
                    <p className="m-0 mt-2 text-[0.75rem] text-red-400">
                      {authError}
                    </p>
                  )}
                </>
              )}

              {/* Footer cancel */}
              <div className="flex justify-end mt-5">
                <button
                  className="px-4 py-2.5 rounded-lg border-none text-[0.8125rem] cursor-pointer text-[var(--nim-text-muted)] bg-transparent transition-colors duration-150 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Privacy explanation */}
              <div className="flex gap-3 p-3 mb-5 rounded-lg bg-[var(--nim-bg-hover)]">
                <MaterialSymbol icon="lock" size={18} className="shrink-0 mt-0.5 text-[var(--nim-text-muted)]" />
                <div>
                  <p className="m-0 text-[0.8125rem] text-[var(--nim-text)]">
                    Anyone with the link can view this {contentLabel}
                  </p>
                  <p className="m-0 mt-1 text-[0.75rem] text-[var(--nim-text-faint)]">
                    Content is end-to-end encrypted.
                    <br />
                    No one without the link -- including Nimbalyst Servers -- can see it.
                  </p>
                </div>
              </div>

              {/* Expiration dropdown */}
              {shareState !== 'success' && (
                <div className="mb-5">
                  <label className="block text-[0.75rem] font-medium text-[var(--nim-text-muted)] mb-1.5">
                    Link expires after
                  </label>
                  <select
                    className="w-full px-3 py-2 text-[0.8125rem] rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] cursor-pointer outline-none transition-colors duration-150 focus:border-[var(--nim-primary)] [&>option]:bg-[var(--nim-bg)] [&>option]:text-[var(--nim-text)]"
                    value={String(expirationDays)}
                    onChange={(e) => {
                      setExpirationDays(Number(e.target.value));
                    }}
                  >
                    {EXPIRATION_OPTIONS.map((opt) => (
                      <option key={String(opt.value)} value={String(opt.value)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="m-0 mt-1.5 text-[0.6875rem] text-[var(--nim-text-faint)]">
                    Your choice will be remembered for next time
                  </p>
                </div>
              )}

              {/* Success state: show URL */}
              {shareState === 'success' && shareUrl && (
                <div className="mb-5">
                  <label className="block text-[0.75rem] font-medium text-[var(--nim-text-muted)] mb-1.5">
                    Share link
                  </label>
                  <div className="flex gap-2">
                    <input
                      ref={urlInputRef}
                      type="text"
                      readOnly
                      value={shareUrl}
                      className="flex-1 min-w-0 px-3 py-2 text-[0.8125rem] rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-hover)] text-[var(--nim-text)] outline-none select-text"
                      onClick={() => urlInputRef.current?.select()}
                    />
                    <button
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-[0.8125rem] rounded-lg border border-[var(--nim-border)] bg-transparent text-[var(--nim-text)] cursor-pointer transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
                      onClick={handleCopyUrl}
                    >
                      <MaterialSymbol icon={urlCopied ? 'check' : 'content_copy'} size={14} />
                      {urlCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {/* Error state */}
              {shareState === 'error' && (
                <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="m-0 text-[0.8125rem] text-red-400">{errorMessage}</p>
                </div>
              )}

              {/* Action button */}
              <div className="flex justify-end gap-2">
                {shareState === 'success' ? (
                  <button
                    className="px-5 py-2.5 rounded-lg border-none text-[0.8125rem] font-medium cursor-pointer text-[var(--nim-text)] bg-[var(--nim-bg-hover)] transition-colors duration-150 hover:bg-[var(--nim-border)]"
                    onClick={onClose}
                  >
                    Done
                  </button>
                ) : (
                  <>
                    <button
                      className="px-4 py-2.5 rounded-lg border-none text-[0.8125rem] cursor-pointer text-[var(--nim-text-muted)] bg-transparent transition-colors duration-150 hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                    <button
                      className="flex items-center gap-2 px-5 py-2.5 rounded-lg border-none text-[0.8125rem] font-medium cursor-pointer text-white bg-[var(--nim-primary)] transition-all duration-150 hover:brightness-110 disabled:opacity-50 disabled:cursor-default"
                      onClick={handleShare}
                      disabled={shareState === 'sharing'}
                    >
                      {shareState === 'sharing' ? (
                        <>
                          <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
                          Sharing...
                        </>
                      ) : shareState === 'error' ? (
                        'Retry'
                      ) : isAlreadyShared ? (
                        <>
                          <MaterialSymbol icon="link" size={14} />
                          Update link
                        </>
                      ) : (
                        <>
                          <MaterialSymbol icon="link" size={14} />
                          Copy link
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
