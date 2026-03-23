/**
 * <nim-list> - Data list with dividers
 *
 * Attributes:
 *   dividers: boolean (show dividers between items, default true)
 *
 * Usage:
 *   <nim-list>
 *     <div>Item 1</div>
 *     <div>Item 2</div>
 *     <div>Item 3</div>
 *   </nim-list>
 */
export const NIM_LIST_SRC = `
class NimList extends HTMLElement {
  static get observedAttributes() { return ['dividers']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const showDividers = !this.hasAttribute('dividers') || this.getAttribute('dividers') !== 'false';

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; }
        ::slotted(*) {
          padding: 10px 12px;
          color: var(--mockup-text);
          \${showDividers ? 'border-bottom: 1px solid var(--mockup-border-subtle);' : ''}
        }
        ::slotted(*:last-child) {
          border-bottom: none;
        }
        ::slotted(*:hover) {
          background: var(--mockup-bg-tertiary);
        }
      </style>
      <slot></slot>
    \`;
  }
}
customElements.define('nim-list', NimList);
`;
