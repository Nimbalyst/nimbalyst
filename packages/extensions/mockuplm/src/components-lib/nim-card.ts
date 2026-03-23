/**
 * <nim-card> - Container card with optional title
 *
 * Attributes:
 *   title: optional header text
 *   padding: "none" | "sm" | "md" | "lg" (default: "md")
 *
 * Usage:
 *   <nim-card title="Settings">Card content here</nim-card>
 *   <nim-card>Untitled card</nim-card>
 */
export const NIM_CARD_SRC = `
class NimCard extends HTMLElement {
  static get observedAttributes() { return ['title', 'padding']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const title = this.getAttribute('title');
    const padding = this.getAttribute('padding') || 'md';
    const padMap = { none: '0', sm: '8px', md: '16px', lg: '24px' };

    this.shadowRoot.innerHTML = \`
      <style>
        :host {
          display: block;
          background: var(--mockup-bg-secondary);
          border: 1px solid var(--mockup-border);
          border-radius: 8px;
          overflow: hidden;
        }
        .header {
          padding: 12px 16px;
          font-size: 14px;
          font-weight: 600;
          color: var(--mockup-text);
          border-bottom: 1px solid var(--mockup-border-subtle);
        }
        .body {
          padding: \${padMap[padding] || padMap.md};
          color: var(--mockup-text);
        }
      </style>
      \${title ? '<div class="header">' + title + '</div>' : ''}
      <div class="body"><slot></slot></div>
    \`;
  }
}
customElements.define('nim-card', NimCard);
`;
