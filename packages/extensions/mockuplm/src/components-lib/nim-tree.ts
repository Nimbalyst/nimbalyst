/**
 * <nim-tree> - Collapsible tree view (file trees, nav trees, etc.)
 *
 * Usage with nested structure:
 *   <nim-tree>
 *     <div slot="node" data-label="src" data-open>
 *       <div slot="node" data-label="components">
 *         <div slot="leaf" data-label="App.tsx" data-icon="code"></div>
 *         <div slot="leaf" data-label="Header.tsx" data-icon="code"></div>
 *       </div>
 *       <div slot="leaf" data-label="index.ts" data-icon="code"></div>
 *     </div>
 *     <div slot="leaf" data-label="package.json" data-icon="settings"></div>
 *   </nim-tree>
 *
 * OR with flat data driven by state:
 *   Use regular HTML with :for and :if to build tree structures.
 */
export const NIM_TREE_SRC = `
class NimTree extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();

    // Toggle node open/closed on click
    this.addEventListener('click', (e) => {
      var node = e.target.closest('[slot="node"]');
      if (node && e.target.closest('.tree-label')) {
        if (node.hasAttribute('data-open')) node.removeAttribute('data-open');
        else node.setAttribute('data-open', '');
        this.render();
        e.stopPropagation();
      }
      var leaf = e.target.closest('[slot="leaf"]');
      if (leaf) {
        // Remove previous selection
        this.querySelectorAll('[data-selected]').forEach(function(el) { el.removeAttribute('data-selected'); });
        leaf.setAttribute('data-selected', '');
        this.dispatchEvent(new CustomEvent('select', {
          detail: { label: leaf.getAttribute('data-label'), element: leaf },
          bubbles: true
        }));
      }
    });
  }

  render() {
    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; font-size: 13px; color: var(--mockup-text); }
        ::slotted([slot="node"]) {
          display: block;
        }
        ::slotted([slot="node"]) > [slot="node"],
        ::slotted([slot="node"]) > [slot="leaf"] {
          padding-left: 16px;
        }
        ::slotted([slot="leaf"]) {
          display: block;
          padding: 3px 8px;
          cursor: pointer;
          border-radius: 4px;
          transition: background 0.1s;
        }
        ::slotted([slot="leaf"]:hover) { background: var(--mockup-bg-tertiary); }
        ::slotted([slot="leaf"][data-selected]) { background: var(--mockup-bg-active); color: var(--mockup-primary); }
      </style>
      <slot name="node"></slot>
      <slot name="leaf"></slot>
    \`;

    // Add tree-label wrappers and indent children
    this._renderNodes(this);
  }

  _renderNodes(root) {
    var nodes = root.querySelectorAll(':scope > [slot="node"]');
    nodes.forEach(function(node) {
      var label = node.getAttribute('data-label') || '';
      var open = node.hasAttribute('data-open');
      var icon = node.getAttribute('data-icon') || 'folder';

      // Check if label element already exists
      var existing = node.querySelector(':scope > .tree-label');
      if (!existing) {
        var labelEl = document.createElement('div');
        labelEl.className = 'tree-label';
        node.insertBefore(labelEl, node.firstChild);
      }
      var labelEl = node.querySelector(':scope > .tree-label');
      labelEl.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;border-radius:4px;user-select:none;font-size:13px;color:var(--mockup-text)">' +
        '<span style="font-size:10px;width:12px;color:var(--mockup-text-muted)">' + (open ? '\\u25BE' : '\\u25B8') + '</span>' +
        label + '</span>';

      // Show/hide children
      var children = node.querySelectorAll(':scope > [slot="node"], :scope > [slot="leaf"]');
      children.forEach(function(child) {
        child.style.display = open ? '' : 'none';
        child.style.paddingLeft = '16px';
      });
    });

    // Style leaf items
    var leaves = root.querySelectorAll(':scope > [slot="leaf"]');
    leaves.forEach(function(leaf) {
      var label = leaf.getAttribute('data-label') || '';
      if (!leaf.textContent.trim()) {
        leaf.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:0 8px;font-size:13px">' + label + '</span>';
      }
    });
  }
}
customElements.define('nim-tree', NimTree);
`;
