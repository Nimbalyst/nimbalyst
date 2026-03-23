/**
 * <nim-tooltip> - Hover tooltip wrapper
 *
 * Attributes:
 *   text: tooltip text
 *   position: top | bottom | left | right (default: top)
 *
 * Usage:
 *   <nim-tooltip text="Save your changes">
 *     <nim-button variant="primary">Save</nim-button>
 *   </nim-tooltip>
 */
export const NIM_TOOLTIP_SRC = `
class NimTooltip extends HTMLElement {
  static get observedAttributes() { return ['text', 'position']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    var text = this.getAttribute('text') || '';
    var pos = this.getAttribute('position') || 'top';

    var posStyles = {
      top: 'bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);',
      bottom: 'top: calc(100% + 6px); left: 50%; transform: translateX(-50%);',
      left: 'right: calc(100% + 6px); top: 50%; transform: translateY(-50%);',
      right: 'left: calc(100% + 6px); top: 50%; transform: translateY(-50%);',
    };

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: inline-block; position: relative; }
        .tip {
          display: none;
          position: absolute;
          \${posStyles[pos] || posStyles.top}
          padding: 5px 10px;
          font-size: 11px;
          color: var(--mockup-text);
          background: var(--mockup-bg-secondary);
          border: 1px solid var(--mockup-border);
          border-radius: 6px;
          box-shadow: 0 2px 8px var(--mockup-shadow);
          white-space: nowrap;
          z-index: 1000;
          pointer-events: none;
        }
        :host(:hover) .tip { display: block; }
      </style>
      <slot></slot>
      \${text ? '<div class="tip">' + text + '</div>' : ''}
    \`;
  }
}
customElements.define('nim-tooltip', NimTooltip);
`;
