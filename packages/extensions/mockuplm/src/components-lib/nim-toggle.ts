/**
 * <nim-toggle> - Toggle switch
 *
 * Attributes:
 *   checked: boolean
 *   disabled: boolean
 *   label: optional label text
 *
 * Events:
 *   change: dispatched on the host element when toggled (detail: { checked })
 *
 * Usage:
 *   <nim-toggle checked label="Dark mode" />
 *   <nim-toggle @click="darkMode = !darkMode" :checked="darkMode" label="Dark mode" />
 */
export const NIM_TOGGLE_SRC = `
class NimToggle extends HTMLElement {
  static get observedAttributes() { return ['checked', 'disabled', 'label']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._checked = false;
  }

  connectedCallback() {
    this._checked = this.hasAttribute('checked');
    this.render();
    this.shadowRoot.querySelector('.track')?.addEventListener('click', () => {
      if (this.hasAttribute('disabled')) return;
      this._checked = !this._checked;
      if (this._checked) this.setAttribute('checked', '');
      else this.removeAttribute('checked');
      this.render();
      this.dispatchEvent(new CustomEvent('change', { detail: { checked: this._checked }, bubbles: true }));
    });
  }

  attributeChangedCallback() {
    this._checked = this.hasAttribute('checked');
    this.render();
  }

  render() {
    const checked = this._checked;
    const disabled = this.hasAttribute('disabled');
    const label = this.getAttribute('label');

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: inline-flex; align-items: center; gap: 8px; cursor: \${disabled ? 'not-allowed' : 'pointer'}; }
        .track {
          width: 36px;
          height: 20px;
          border-radius: 10px;
          background: \${checked ? 'var(--mockup-primary)' : 'var(--mockup-bg-active)'};
          position: relative;
          cursor: inherit;
          transition: background 0.2s;
          opacity: \${disabled ? '0.5' : '1'};
        }
        .thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #fff;
          position: absolute;
          top: 2px;
          left: \${checked ? '18px' : '2px'};
          transition: left 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .label { font-size: 13px; color: var(--mockup-text); }
      </style>
      <div class="track"><div class="thumb"></div></div>
      \${label ? '<span class="label">' + label + '</span>' : ''}
    \`;
  }
}
customElements.define('nim-toggle', NimToggle);
`;
