/**
 * <nim-badge> - Status badge / tag
 *
 * Attributes:
 *   variant: primary | success | warning | error | secondary | ghost (default: primary)
 *   size: sm | md (default: md)
 *   pill: boolean - rounded pill shape
 *
 * Usage:
 *   <nim-badge variant="success">Active</nim-badge>
 *   <nim-badge variant="error" pill>3 errors</nim-badge>
 *   <nim-badge variant="warning" size="sm">Beta</nim-badge>
 */
export const NIM_BADGE_SRC = `
class NimBadge extends HTMLElement {
  static get observedAttributes() { return ['variant', 'size', 'pill']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    var variant = this.getAttribute('variant') || 'primary';
    var size = this.getAttribute('size') || 'md';
    var pill = this.hasAttribute('pill');

    var colors = {
      primary:   { bg: 'var(--mockup-primary)',   text: 'var(--mockup-primary-text)' },
      success:   { bg: 'var(--mockup-success)',    text: '#fff' },
      warning:   { bg: 'var(--mockup-warning)',    text: '#000' },
      error:     { bg: 'var(--mockup-error)',      text: '#fff' },
      secondary: { bg: 'var(--mockup-bg-tertiary)', text: 'var(--mockup-text)' },
      ghost:     { bg: 'transparent',              text: 'var(--mockup-text-muted)' }
    };
    var c = colors[variant] || colors.primary;
    var padding = size === 'sm' ? '2px 6px' : '3px 10px';
    var fontSize = size === 'sm' ? '10px' : '11px';

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: inline-flex; }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: \${padding};
          font-size: \${fontSize};
          font-weight: 600;
          letter-spacing: 0.02em;
          background: \${c.bg};
          color: \${c.text};
          border-radius: \${pill ? '100px' : '4px'};
          border: \${variant === 'ghost' ? '1px solid var(--mockup-border)' : 'none'};
          white-space: nowrap;
          line-height: 1.4;
        }
      </style>
      <span class="badge"><slot></slot></span>
    \`;
  }
}
customElements.define('nim-badge', NimBadge);
`;
