/**
 * <nim-dropdown> - Dropdown menu that opens on click
 *
 * Attributes:
 *   label: button label text
 *   variant: primary | secondary | ghost (default: ghost)
 *   open: boolean - whether dropdown is open
 *
 * Events:
 *   select: dispatched when an item is clicked (detail: { value, label })
 *
 * Usage:
 *   <nim-dropdown label="Actions">
 *     <div slot="item" data-value="edit">Edit</div>
 *     <div slot="item" data-value="delete" data-danger>Delete</div>
 *     <div slot="divider"></div>
 *     <div slot="item" data-value="settings">Settings</div>
 *   </nim-dropdown>
 */
export const NIM_DROPDOWN_SRC = `
class NimDropdown extends HTMLElement {
  static get observedAttributes() { return ['label', 'variant', 'open']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._open = false;
  }

  connectedCallback() {
    this.render();

    // Toggle on button click
    this.shadowRoot.addEventListener('click', (e) => {
      var btn = e.target.closest('.trigger');
      if (btn) {
        this._open = !this._open;
        this.render();
        return;
      }
    });

    // Handle item clicks from light DOM
    this.addEventListener('click', (e) => {
      var item = e.target.closest('[slot="item"]');
      if (item) {
        var value = item.getAttribute('data-value') || item.textContent.trim();
        this._open = false;
        this.render();
        this.dispatchEvent(new CustomEvent('select', {
          detail: { value: value, label: item.textContent.trim() },
          bubbles: true
        }));
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target) && this._open) {
        this._open = false;
        this.render();
      }
    });
  }

  attributeChangedCallback() { this.render(); }

  render() {
    var label = this.getAttribute('label') || 'Menu';
    var variant = this.getAttribute('variant') || 'ghost';
    var open = this._open;

    var btnBg = variant === 'primary' ? 'var(--mockup-primary)' :
                variant === 'secondary' ? 'var(--mockup-bg-tertiary)' : 'transparent';
    var btnColor = variant === 'primary' ? 'var(--mockup-primary-text)' : 'var(--mockup-text)';
    var btnBorder = variant === 'ghost' ? '1px solid var(--mockup-border)' :
                    variant === 'primary' ? '1px solid var(--mockup-primary)' : '1px solid var(--mockup-border)';

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: inline-block; position: relative; }
        .trigger {
          padding: 6px 12px;
          font-size: 13px;
          font-family: inherit;
          background: \${btnBg};
          color: \${btnColor};
          border: \${btnBorder};
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: background 0.1s;
        }
        .trigger:hover { opacity: 0.9; }
        .chevron { font-size: 10px; }
        .menu {
          display: \${open ? 'block' : 'none'};
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          min-width: 160px;
          background: var(--mockup-bg-secondary);
          border: 1px solid var(--mockup-border);
          border-radius: 8px;
          padding: 4px 0;
          box-shadow: 0 4px 16px var(--mockup-shadow);
          z-index: 100;
        }
        ::slotted([slot="item"]) {
          display: block;
          padding: 8px 14px;
          font-size: 13px;
          color: var(--mockup-text);
          cursor: pointer;
          transition: background 0.1s;
        }
        ::slotted([slot="item"]:hover) { background: var(--mockup-bg-tertiary); }
        ::slotted([slot="item"][data-danger]) { color: var(--mockup-error); }
        ::slotted([slot="divider"]) {
          display: block;
          height: 1px;
          background: var(--mockup-border);
          margin: 4px 0;
        }
      </style>
      <button class="trigger">\${label} <span class="chevron">\${open ? '\\u25B4' : '\\u25BE'}</span></button>
      <div class="menu">
        <slot name="item"></slot>
        <slot name="divider"></slot>
      </div>
    \`;
  }
}
customElements.define('nim-dropdown', NimDropdown);
`;
