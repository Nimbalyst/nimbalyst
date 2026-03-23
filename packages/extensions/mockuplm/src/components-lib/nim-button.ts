/**
 * <nim-button> - Themed button component
 *
 * Attributes:
 *   variant: "primary" | "secondary" | "ghost" | "danger" (default: "primary")
 *   size: "sm" | "md" | "lg" (default: "md")
 *   disabled: boolean
 *
 * Usage:
 *   <nim-button variant="primary">Save</nim-button>
 *   <nim-button variant="ghost" size="sm">Cancel</nim-button>
 */
export const NIM_BUTTON_SRC = `
class NimButton extends HTMLElement {
  static get observedAttributes() { return ['variant', 'size', 'disabled']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const variant = this.getAttribute('variant') || 'primary';
    const size = this.getAttribute('size') || 'md';
    const disabled = this.hasAttribute('disabled');

    const sizeMap = { sm: '6px 12px', md: '8px 16px', lg: '10px 20px' };
    const fontMap = { sm: '12px', md: '13px', lg: '14px' };

    const variantStyles = {
      primary: 'background: var(--mockup-primary); color: var(--mockup-primary-text); border-color: var(--mockup-primary);',
      secondary: 'background: var(--mockup-bg-tertiary); color: var(--mockup-text); border-color: var(--mockup-border);',
      ghost: 'background: transparent; color: var(--mockup-text); border-color: transparent;',
      danger: 'background: var(--mockup-error); color: #fff; border-color: var(--mockup-error);',
    };

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: inline-flex; }
        button {
          \${variantStyles[variant] || variantStyles.primary}
          padding: \${sizeMap[size] || sizeMap.md};
          font-size: \${fontMap[size] || fontMap.md};
          font-family: inherit;
          font-weight: 500;
          border: 1px solid;
          border-radius: 6px;
          cursor: \${disabled ? 'not-allowed' : 'pointer'};
          opacity: \${disabled ? '0.5' : '1'};
          transition: opacity 0.15s, filter 0.15s;
          line-height: 1.4;
          white-space: nowrap;
        }
        button:hover:not(:disabled) { filter: brightness(1.1); }
        button:active:not(:disabled) { filter: brightness(0.95); }
      </style>
      <button \${disabled ? 'disabled' : ''}><slot></slot></button>
    \`;
  }
}
customElements.define('nim-button', NimButton);
`;
