/**
 * <nim-input> - Themed text input
 *
 * Attributes:
 *   placeholder, value, type, disabled
 *
 * Usage:
 *   <nim-input placeholder="Email address" />
 *   <nim-input type="password" placeholder="Password" />
 */
export const NIM_INPUT_SRC = `
class NimInput extends HTMLElement {
  static get observedAttributes() { return ['placeholder', 'value', 'type', 'disabled']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const placeholder = this.getAttribute('placeholder') || '';
    const value = this.getAttribute('value') || '';
    const type = this.getAttribute('type') || 'text';
    const disabled = this.hasAttribute('disabled');

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; }
        input {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 12px;
          font-size: 13px;
          font-family: inherit;
          color: var(--mockup-text);
          background: var(--mockup-bg);
          border: 1px solid var(--mockup-border);
          border-radius: 6px;
          outline: none;
          transition: border-color 0.15s;
        }
        input:focus { border-color: var(--mockup-primary); }
        input::placeholder { color: var(--mockup-text-faint); }
        input:disabled { opacity: 0.5; cursor: not-allowed; }
      </style>
      <input type="\${type}" placeholder="\${placeholder}" value="\${value}" \${disabled ? 'disabled' : ''} />
    \`;
  }
}
customElements.define('nim-input', NimInput);
`;
