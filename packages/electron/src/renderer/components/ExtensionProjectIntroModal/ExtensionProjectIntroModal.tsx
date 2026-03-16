import React from 'react';

export interface ExtensionProjectIntroModalProps {
  isOpen: boolean;
  onContinue: () => void;
  onDontShowAgain: () => void;
  onCancel: () => void;
}

const capabilityCards = [
  {
    icon: 'edit_square',
    title: 'Custom editors',
    description: 'Build file-specific editors, views, and interactions that feel native inside Nimbalyst.',
  },
  {
    icon: 'psychology',
    title: 'AI tools',
    description: 'Expose extension features to agents so Claude can use them while working in your project.',
  },
  {
    icon: 'deployed_code',
    title: 'In-app dev loop',
    description: 'Load the extension directly in Nimbalyst, then build, install, and reload it while you iterate.',
  },
];

export const ExtensionProjectIntroModal: React.FC<ExtensionProjectIntroModalProps> = ({
  isOpen,
  onContinue,
  onDontShowAgain,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="nim-overlay backdrop-blur-sm bg-black/55"
      onClick={onCancel}
    >
      <div
        className="nim-modal w-[92%] max-w-[640px] overflow-hidden border border-nim bg-nim shadow-[0_30px_100px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-nim bg-[linear-gradient(135deg,var(--nim-bg-secondary),color-mix(in_srgb,var(--nim-primary)_10%,var(--nim-bg-secondary)))] px-7 py-7">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[color:color-mix(in_srgb,var(--nim-primary)_32%,var(--nim-border))] bg-[color:color-mix(in_srgb,var(--nim-primary)_14%,transparent)] text-[var(--nim-primary)]">
            <span className="material-symbols-outlined text-[30px]">extension</span>
          </div>
          <h2 className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-nim">
            Build with Extensions
          </h2>
          <p className="mt-3 max-w-[520px] text-[15px] leading-7 text-nim-muted">
            Extensions can add custom editors, AI tools, commands, panels, and other workspace features.
            Nimbalyst can load your extension while you develop so you can test changes without leaving the app.
          </p>
        </div>

        <div className="px-7 py-6">
          <div className="grid gap-3 md:grid-cols-3">
            {capabilityCards.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-nim bg-nim-secondary px-4 py-4"
              >
                <span className="material-symbols-outlined mb-3 text-[22px] text-[var(--nim-primary)]">
                  {card.icon}
                </span>
                <div className="mb-1 text-sm font-semibold text-nim">{card.title}</div>
                <div className="text-[13px] leading-6 text-nim-muted">{card.description}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-nim bg-[color:color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))] px-4 py-4">
            <div className="mb-1 text-sm font-semibold text-nim">What happens next</div>
            <div className="text-[13px] leading-6 text-nim-muted">
              Start from a template now, then ask Claude to build, install, and reload the extension as you iterate.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-nim px-7 py-5">
          <button
            className="nim-btn-secondary rounded-lg px-5 py-2.5 text-sm font-medium"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-lg border border-nim bg-transparent px-5 py-2.5 text-sm font-medium text-nim-muted transition-colors hover:bg-nim-secondary hover:text-nim"
            onClick={onDontShowAgain}
          >
            Don&apos;t Show Again
          </button>
          <button
            className="nim-btn-primary rounded-lg px-6 py-2.5 text-sm font-semibold shadow-[0_8px_24px_color-mix(in_srgb,var(--nim-primary)_24%,transparent)] transition-transform hover:-translate-y-px"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};
