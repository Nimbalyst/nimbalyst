# Using getDOMSlot for Custom Lexical Components

## Overview

`getDOMSlot` is an experimental Lexical API that allows you to control exactly where child nodes are inserted in your custom component's DOM structure. This is perfect for creating complex layouts where children need to be placed in specific containers.

## How It Works

When Lexical renders your node's children, it calls `getDOMSlot` for each child to determine where in the DOM that child should be placed. The method returns a `DOMSlot` object with three properties:

```typescript
interface DOMSlot {
  element: HTMLElement | null;  // The container where the child should be inserted
  after?: Node;                 // Insert after this node (optional)
  before?: Node;                // Insert before this node (optional)
}
```

## Example: Card Component with Title and Content Slots

Here's how to create a card component where:
- The first child goes into a styled title area
- All other children go into a content area

```typescript
import { ElementNode, LexicalNode, DOMSlot } from 'lexical';

export class CardNode extends ElementNode {
  static getType(): string {
    return 'card';
  }

  createDOM(): HTMLElement {
    // Create the card structure
    const container = document.createElement('div');
    container.className = 'card-node';
    
    // Create title slot
    const titleSlot = document.createElement('div');
    titleSlot.className = 'card-title';
    titleSlot.setAttribute('data-lexical-slot', 'title');
    
    // Create content slot
    const contentSlot = document.createElement('div');
    contentSlot.className = 'card-content';
    contentSlot.setAttribute('data-lexical-slot', 'content');
    
    // Assemble the structure
    container.appendChild(titleSlot);
    container.appendChild(contentSlot);
    
    return container;
  }

  getDOMSlot(child: LexicalNode): DOMSlot {
    const element = this.getDOM();
    if (!element) {
      return { element: null };
    }
    
    const children = this.getChildren();
    const childIndex = children.indexOf(child);
    
    // First child goes in title slot
    if (childIndex === 0) {
      const titleSlot = element.querySelector('[data-lexical-slot="title"]');
      return { element: titleSlot as HTMLElement };
    }
    
    // All other children go in content slot
    const contentSlot = element.querySelector('[data-lexical-slot="content"]');
    return { element: contentSlot as HTMLElement };
  }

  // ... rest of the node implementation
}
```

## Benefits

1. **Clean DOM Structure**: Your component can have any DOM structure you want
2. **Automatic Child Placement**: Children are automatically placed in the correct slots
3. **No Nested Editors**: Everything stays in the main editor - no need for nested composers
4. **Full Lexical Integration**: Children remain part of the main editor tree

## CSS Styling

With this structure, you can easily style the slots:

```css
.card-node {
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  max-width: 600px;
  margin: 16px auto;
}

.card-title {
  background: #f5f5f5;
  padding: 16px 20px;
  font-size: 1.25rem;
  font-weight: 600;
  border-bottom: 1px solid #e0e0e0;
}

.card-content {
  padding: 20px;
}
```

## Advanced Usage

You can also use the `after` and `before` properties for more complex layouts:

```typescript
getDOMSlot(child: LexicalNode): DOMSlot {
  const element = this.getDOM();
  const contentSlot = element?.querySelector('.content');
  
  // Insert this child after a specific separator
  const separator = element?.querySelector('.section-separator');
  
  return {
    element: contentSlot as HTMLElement,
    after: separator || undefined
  };
}
```

## Important Notes

- `getDOMSlot` is currently an experimental/internal API
- Always check if the DOM element exists before returning it
- The method is called for each child during rendering
- Changes to the slot structure require a DOM update
