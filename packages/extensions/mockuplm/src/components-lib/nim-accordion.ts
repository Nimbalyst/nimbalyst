/**
 * <nim-accordion> - Collapsible accordion sections
 *
 * Usage:
 *   <nim-accordion>
 *     <div slot="section" data-title="Section 1" data-open>Content 1</div>
 *     <div slot="section" data-title="Section 2">Content 2</div>
 *   </nim-accordion>
 */
export const NIM_ACCORDION_SRC = `
class NimAccordion extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.addEventListener('click', (e) => {
      var header = e.target.closest('.acc-header');
      if (!header) return;
      var idx = header.getAttribute('data-idx');
      var sections = this.querySelectorAll('[slot="section"]');
      var section = sections[parseInt(idx)];
      if (section) {
        if (section.hasAttribute('data-open')) section.removeAttribute('data-open');
        else section.setAttribute('data-open', '');
        this.render();
      }
    });
  }

  render() {
    var sections = Array.from(this.querySelectorAll('[slot="section"]'));
    var headers = sections.map(function(s, i) {
      var title = s.getAttribute('data-title') || 'Section ' + (i + 1);
      var open = s.hasAttribute('data-open');
      return '<div class="acc-header' + (open ? ' open' : '') + '" data-idx="' + i + '">' +
        '<span class="chevron">' + (open ? '\\u25BE' : '\\u25B8') + '</span>' +
        '<span>' + title + '</span></div>';
    }).join('');

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; border: 1px solid var(--mockup-border); border-radius: 8px; overflow: hidden; }
        .acc-header {
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 500;
          color: var(--mockup-text);
          background: var(--mockup-bg-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--mockup-border);
          user-select: none;
          transition: background 0.1s;
        }
        .acc-header:hover { background: var(--mockup-bg-tertiary); }
        .acc-header:last-of-type { border-bottom: none; }
        .chevron { font-size: 10px; color: var(--mockup-text-muted); width: 12px; }
        ::slotted([slot="section"]) { display: none; padding: 12px 14px; border-bottom: 1px solid var(--mockup-border); }
        ::slotted([slot="section"]:last-child) { border-bottom: none; }
        ::slotted([slot="section"][data-open]) { display: block; }
      </style>
      \${headers}
      <slot name="section"></slot>
    \`;
  }
}
customElements.define('nim-accordion', NimAccordion);
`;
