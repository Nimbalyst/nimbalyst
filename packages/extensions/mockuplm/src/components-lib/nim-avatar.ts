/**
 * <nim-avatar> - User avatar with initials fallback
 *
 * Attributes:
 *   name: user name (initials derived from this)
 *   src: image URL (optional)
 *   size: "sm" | "md" | "lg" (default: "md")
 *
 * Usage:
 *   <nim-avatar name="Alice Smith" />
 *   <nim-avatar name="Bob" size="lg" />
 */
export const NIM_AVATAR_SRC = `
class NimAvatar extends HTMLElement {
  static get observedAttributes() { return ['name', 'src', 'size']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }

  render() {
    const name = this.getAttribute('name') || '?';
    const src = this.getAttribute('src');
    const size = this.getAttribute('size') || 'md';
    const sizeMap = { sm: '24px', md: '32px', lg: '48px' };
    const fontMap = { sm: '10px', md: '13px', lg: '18px' };
    const dim = sizeMap[size] || sizeMap.md;
    const font = fontMap[size] || fontMap.md;

    // Generate initials
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    // Generate a color from the name
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;

    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: inline-flex; }
        .avatar {
          width: \${dim};
          height: \${dim};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: \${font};
          font-weight: 600;
          color: #fff;
          background: hsl(\${hue}, 55%, 50%);
          overflow: hidden;
          flex-shrink: 0;
        }
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      </style>
      <div class="avatar">
        \${src ? '<img src="' + src + '" alt="' + name + '" />' : initials}
      </div>
    \`;
  }
}
customElements.define('nim-avatar', NimAvatar);
`;
