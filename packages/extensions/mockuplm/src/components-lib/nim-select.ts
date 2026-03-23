/**
 * <nim-select> - Themed dropdown select
 *
 * Attributes:
 *   placeholder: placeholder text
 *   disabled: boolean
 *   value: currently selected value
 *
 * Events:
 *   change: dispatched on host element when selection changes (e.target.value = selected value)
 *
 * Usage:
 *   <nim-select placeholder="Choose..." @change="selected = $event">
 *     <option value="a">Option A</option>
 *     <option value="b">Option B</option>
 *   </nim-select>
 */
export const NIM_SELECT_SRC = `
class NimSelect extends HTMLElement {
  static get observedAttributes() { return ['placeholder', 'disabled', 'value']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); this._attachListeners(); }
  attributeChangedCallback() { this.render(); }

  get value() {
    var sel = this.shadowRoot.querySelector('select');
    return sel ? sel.value : '';
  }
  set value(v) {
    this.setAttribute('value', v);
    var sel = this.shadowRoot.querySelector('select');
    if (sel) sel.value = v;
  }

  _attachListeners() {
    this.shadowRoot.addEventListener('change', (e) => {
      var val = e.target.value;
      // Re-dispatch as a native-like event on the host element so @change works
      this.dispatchEvent(new Event('change', { bubbles: true }));
      // Also set a .value property on the host element for $event access
      this._value = val;
    });
  }

  render() {
    const disabled = this.hasAttribute('disabled');
    const currentValue = this.getAttribute('value') || '';

    const options = Array.from(this.querySelectorAll('option'))
      .map(opt => {
        var val = opt.getAttribute('value') || '';
        var selected = val === currentValue || opt.hasAttribute('selected');
        return '<option value="' + val + '"' + (selected ? ' selected' : '') + '>' + opt.textContent + '</option>';
      })
      .join('');

    const placeholder = this.getAttribute('placeholder');
    const placeholderOpt = placeholder
      ? '<option value="" disabled' + (!currentValue ? ' selected' : '') + '>' + placeholder + '</option>'
      : '';

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; }
        select {
          width: 100%;
          padding: 8px 32px 8px 12px;
          font-size: 13px;
          font-family: inherit;
          color: var(--mockup-text);
          background: var(--mockup-bg);
          border: 1px solid var(--mockup-border);
          border-radius: 6px;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%23808080' d='M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          cursor: pointer;
          transition: border-color 0.15s;
        }
        select:focus { border-color: var(--mockup-primary); }
        select:disabled { opacity: 0.5; cursor: not-allowed; }
      </style>
      <select \${disabled ? 'disabled' : ''}>\${placeholderOpt}\${options}</select>
    \`;
  }
}
customElements.define('nim-select', NimSelect);
`;
