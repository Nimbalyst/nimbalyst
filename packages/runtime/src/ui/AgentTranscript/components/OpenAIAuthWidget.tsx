import React, { useEffect } from 'react';

// Inject styles once
const injectOpenAIAuthWidgetStyles = () => {
  const styleId = 'openai-auth-widget-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .openai-auth-widget {
      background-color: color-mix(in srgb, var(--nim-error) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--nim-error) 25%, transparent);
    }
  `;
  document.head.appendChild(style);
};

export const OpenAIAuthWidget: React.FC = () => {
  useEffect(() => {
    injectOpenAIAuthWidgetStyles();
  }, []);

  return (
    <div className="openai-auth-widget my-4 p-4 rounded-lg flex flex-col gap-3">
      <div className="text-[var(--nim-text)] text-sm font-medium">
        OpenAI authentication required
      </div>
      <p className="text-[13px] text-[var(--nim-text-muted)] leading-relaxed">
        Before using OpenAI Codex, you need to install the Codex CLI and log in with your OpenAI account.
      </p>
      <p className="text-[13px] text-[var(--nim-text-muted)] leading-relaxed">
        See the{' '}
        <a
          href="https://github.com/openai/codex"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--nim-primary)] hover:underline"
        >
          OpenAI Codex setup instructions
        </a>
        {' '}for installation and authentication steps.
      </p>
    </div>
  );
};
