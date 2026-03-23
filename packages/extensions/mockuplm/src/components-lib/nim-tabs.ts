/**
 * <nim-tabs> - Tab navigation with slot-based content
 *
 * Attributes:
 *   active: ID of active tab
 *
 * Events:
 *   change: dispatched when tab is clicked (detail: { tabId })
 *
 * Usage:
 *   <nim-tabs active="general" @change="activeTab = $event.detail.tabId">
 *     <div slot="tab" data-id="general">General</div>
 *     <div slot="tab" data-id="advanced">Advanced</div>
 *     <div slot="panel" data-id="general">General content</div>
 *     <div slot="panel" data-id="advanced">Advanced content</div>
 *   </nim-tabs>
 */
export const NIM_TABS_SRC = `
class NimTabs extends HTMLElement {
  static get observedAttributes() { return ['active']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._attachTabListeners();
  }
  attributeChangedCallback() { this.render(); }

  _attachTabListeners() {
    // Listen for clicks on tab slots
    this.addEventListener('click', (e) => {
      var tab = e.target.closest('[slot="tab"]');
      if (!tab) return;
      var tabId = tab.getAttribute('data-id');
      if (tabId) {
        this.setAttribute('active', tabId);
        this.render();
        this.dispatchEvent(new CustomEvent('change', { detail: { tabId: tabId }, bubbles: true }));
      }
    });
  }

  render() {
    const active = this.getAttribute('active') || '';

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; }
        .tab-bar {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--mockup-border);
          margin-bottom: 12px;
        }
        ::slotted([slot="tab"]) {
          padding: 8px 16px;
          font-size: 13px;
          color: var(--mockup-text-muted);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s;
          user-select: none;
        }
        ::slotted([slot="tab"]:hover) {
          color: var(--mockup-text);
        }
        ::slotted([slot="tab"][data-active]) {
          color: var(--mockup-primary);
          border-bottom-color: var(--mockup-primary);
          font-weight: 500;
        }
        ::slotted([slot="panel"]) { display: none; }
        ::slotted([slot="panel"][data-active]) { display: block; }
      </style>
      <div class="tab-bar"><slot name="tab"></slot></div>
      <slot name="panel"></slot>
    \`;

    this.querySelectorAll('[slot="tab"]').forEach(tab => {
      if (tab.getAttribute('data-id') === active) tab.setAttribute('data-active', '');
      else tab.removeAttribute('data-active');
    });
    this.querySelectorAll('[slot="panel"]').forEach(panel => {
      if (panel.getAttribute('data-id') === active) panel.setAttribute('data-active', '');
      else panel.removeAttribute('data-active');
    });
  }
}
customElements.define('nim-tabs', NimTabs);
`;
