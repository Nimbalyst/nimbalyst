import React, { useCallback, useState } from 'react';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';

export type FeedbackKind = 'bug' | 'feature';

export interface FeedbackIntakeLaunchOptions {
  kind: FeedbackKind;
  mayGatherLogs: boolean;
}

export interface FeedbackIntakeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (options: FeedbackIntakeLaunchOptions) => void;
}

const ISSUES_URL = 'https://github.com/nimbalyst/nimbalyst/issues';
const DISCUSSIONS_URL = 'https://github.com/nimbalyst/nimbalyst/discussions';
const SUPPORT_EMAIL_URL = 'mailto:support@nimbalyst.com';

export const FeedbackIntakeDialog: React.FC<FeedbackIntakeDialogProps> = ({
  isOpen,
  onClose,
  onLaunch,
}) => {
  const posthog = usePostHog();
  const [mayGatherLogs, setMayGatherLogs] = useState(true);

  const handlePick = useCallback(
    (kind: FeedbackKind) => {
      posthog?.capture('feedback_intake_launched', { kind, mayGatherLogs });
      onLaunch({ kind, mayGatherLogs });
      onClose();
    },
    [posthog, mayGatherLogs, onLaunch, onClose],
  );

  const handleOpenExternal = useCallback(
    (url: string, target: 'issues' | 'discussions' | 'email') => {
      posthog?.capture('feedback_external_link_clicked', { target });
      window.electronAPI?.invoke('open-external', url);
      onClose();
    },
    [posthog, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="nim-overlay nim-animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="feedback-intake-overlay"
    >
      <div
        className="nim-animate-slide-up relative w-[520px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="feedback-intake-title"
        data-testid="feedback-intake-dialog"
      >
        <button
          type="button"
          className="absolute top-3.5 right-3.5 z-[1] flex h-8 w-8 items-center justify-center rounded-md border-none bg-transparent text-[var(--nim-text-muted)] transition-colors duration-150 hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
          onClick={onClose}
          aria-label="Close"
          data-testid="feedback-intake-close"
        >
          <MaterialSymbol icon="close" size={20} />
        </button>

        <div className="px-8 pt-8 pb-6">
          <h2
            id="feedback-intake-title"
            className="m-0 mb-1.5 text-xl font-semibold leading-snug text-[var(--nim-text)]"
          >
            Send feedback
          </h2>
          <p className="m-0 mb-6 text-[13px] leading-relaxed text-[var(--nim-text-muted)]">
            The assistant will help you write a clear report and post it to GitHub.
          </p>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              className="group flex w-full items-start gap-3.5 rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-4 text-left text-[var(--nim-text)] transition-all duration-150 hover:border-[var(--nim-primary)] hover:bg-[var(--nim-bg-tertiary)] active:scale-[0.995]"
              onClick={() => handlePick('bug')}
              data-testid="feedback-intake-bug"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--nim-bg-tertiary)] text-[var(--nim-error)]">
                <MaterialSymbol icon="bug_report" size={22} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold leading-snug text-[var(--nim-text)]">
                    Report a bug
                  </span>
                  <span className="rounded-full border border-[rgba(74,222,128,0.4)] bg-[rgba(74,222,128,0.12)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nim-success)]">
                    Recommended
                  </span>
                </span>
                <span className="text-[12.5px] leading-snug text-[var(--nim-text-muted)]">
                  Crashes, errors, broken features. The assistant gathers reproduction steps and logs (if allowed below).
                </span>
              </span>
              <span className="ml-auto self-center text-[var(--nim-text-faint)] transition-colors duration-150 group-hover:text-[var(--nim-primary)]">
                <MaterialSymbol icon="chevron_right" size={20} />
              </span>
            </button>

            <button
              type="button"
              className="group flex w-full items-start gap-3.5 rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-4 text-left text-[var(--nim-text)] transition-all duration-150 hover:border-[var(--nim-primary)] hover:bg-[var(--nim-bg-tertiary)] active:scale-[0.995]"
              onClick={() => handlePick('feature')}
              data-testid="feedback-intake-feature"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--nim-bg-tertiary)] text-[var(--nim-warning)]">
                <MaterialSymbol icon="lightbulb" size={22} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold leading-snug text-[var(--nim-text)]">
                  Request a feature
                </span>
                <span className="text-[12.5px] leading-snug text-[var(--nim-text-muted)]">
                  Something missing? The assistant helps you turn the idea into a clear proposal.
                </span>
              </span>
              <span className="ml-auto self-center text-[var(--nim-text-faint)] transition-colors duration-150 group-hover:text-[var(--nim-primary)]">
                <MaterialSymbol icon="chevron_right" size={20} />
              </span>
            </button>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-[10px] border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-3.5 py-3">
            <input
              id="feedback-may-gather-logs"
              type="checkbox"
              checked={mayGatherLogs}
              onChange={(e) => setMayGatherLogs(e.target.checked)}
              className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer appearance-none rounded border-2 border-[var(--nim-border)] bg-[var(--nim-bg)] checked:border-[var(--nim-primary)] checked:bg-[var(--nim-primary)] checked:bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27white%27%3E%3Cpath%20d=%27M9%2016.17L4.83%2012l-1.42%201.41L9%2019%2021%207l-1.41-1.41L9%2016.17z%27/%3E%3C/svg%3E')] checked:bg-[length:14px] checked:bg-center checked:bg-no-repeat"
              data-testid="feedback-intake-consent"
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor="feedback-may-gather-logs"
                className="block cursor-pointer text-[13px] font-medium leading-snug text-[var(--nim-text)]"
              >
                Allow the assistant to gather logs and environment info
              </label>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--nim-text-muted)]">
                <strong className="font-semibold text-[var(--nim-warning)]">Heads up:</strong>{' '}
                logs may contain file paths, workspace names, and error details. Sensitive data is
                anonymized first by a regex pass and then double-checked by the assistant.{' '}
                <strong className="font-semibold text-[var(--nim-warning)]">
                  You review and approve every report before it&rsquo;s posted.
                </strong>
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-8 pt-4 pb-4.5">
          <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--nim-text-faint)]">
            Other ways to reach us
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <li>
              <button
                type="button"
                className="group -ml-1.5 inline-flex cursor-pointer items-center gap-2 rounded-md bg-transparent px-1.5 py-1 text-[13px] text-[var(--nim-text-muted)] transition-colors duration-150 hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
                onClick={() => handleOpenExternal(ISSUES_URL, 'issues')}
                data-testid="feedback-intake-issues-link"
              >
                <MaterialSymbol
                  icon="search"
                  size={16}
                  className="text-[var(--nim-text-faint)] group-hover:text-[var(--nim-primary)]"
                />
                Browse existing issues on GitHub
              </button>
            </li>
            <li>
              <button
                type="button"
                className="group -ml-1.5 inline-flex cursor-pointer items-center gap-2 rounded-md bg-transparent px-1.5 py-1 text-[13px] text-[var(--nim-text-muted)] transition-colors duration-150 hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
                onClick={() => handleOpenExternal(DISCUSSIONS_URL, 'discussions')}
                data-testid="feedback-intake-discussions-link"
              >
                <MaterialSymbol
                  icon="forum"
                  size={16}
                  className="text-[var(--nim-text-faint)] group-hover:text-[var(--nim-primary)]"
                />
                Discuss an idea on GitHub Discussions
              </button>
            </li>
            <li>
              <button
                type="button"
                className="group -ml-1.5 inline-flex cursor-pointer items-center gap-2 rounded-md bg-transparent px-1.5 py-1 text-[13px] text-[var(--nim-text-muted)] transition-colors duration-150 hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
                onClick={() => handleOpenExternal(SUPPORT_EMAIL_URL, 'email')}
                data-testid="feedback-intake-email-link"
              >
                <MaterialSymbol
                  icon="mail"
                  size={16}
                  className="text-[var(--nim-text-faint)] group-hover:text-[var(--nim-primary)]"
                />
                Email private feedback to support@nimbalyst.com
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export function buildFeedbackInitialDraft(
  kind: FeedbackKind,
  mayGatherLogs: boolean,
): string {
  const command =
    kind === 'bug'
      ? '/nimbalyst-feedback:bug-report'
      : '/nimbalyst-feedback:feature-request';
  const consent = mayGatherLogs ? 'allowed' : 'not allowed';
  return `${command}\n\nLog gathering: ${consent}`;
}
