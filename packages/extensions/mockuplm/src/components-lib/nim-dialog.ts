/**
 * <nim-dialog> - Modal dialog overlay
 *
 * Attributes:
 *   open: boolean
 *   title: dialog title text
 *   width: CSS width (default: "480px")
 *
 * Usage:
 *   <nim-dialog open title="Confirm Delete">
 *     <p>Are you sure?</p>
 *     <nim-button variant="danger">Delete</nim-button>
 *   </nim-dialog>
 */
export const NIM_DIALOG_SRC = `
class NimDialog extends HTMLElement {
  static get observedAttributes() { return ['open', 'title', 'width']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const isOpen = this.hasAttribute('open');
    const title = this.getAttribute('title') || '';
    const width = this.getAttribute('width') || '480px';

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: \${isOpen ? 'block' : 'none'}; }
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .dialog {
          background: var(--mockup-bg-secondary);
          border: 1px solid var(--mockup-border);
          border-radius: 12px;
          width: \${width};
          max-width: 90vw;
          max-height: 80vh;
          overflow: auto;
          box-shadow: 0 8px 32px var(--mockup-shadow);
        }
        .header {
          padding: 16px 20px 12px;
          font-size: 16px;
          font-weight: 600;
          color: var(--mockup-text);
          border-bottom: 1px solid var(--mockup-border-subtle);
        }
        .body {
          padding: 16px 20px 20px;
          color: var(--mockup-text);
        }
      </style>
      <div class="overlay">
        <div class="dialog">
          \${title ? '<div class="header">' + title + '</div>' : ''}
          <div class="body"><slot></slot></div>
        </div>
      </div>
    \`;
  }
}
customElements.define('nim-dialog', NimDialog);
`;
