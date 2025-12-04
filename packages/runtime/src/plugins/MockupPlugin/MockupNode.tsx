/**
 * MockupNode - A Lexical DecoratorNode for embedding wireframe mockups in documents.
 *
 * Displays a screenshot of the wireframe with an edit button overlay.
 * References both the wireframe source file and its cached screenshot.
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import type { JSX } from 'react';

import { $applyNodeReplacement, DecoratorNode } from 'lexical';
import * as React from 'react';

const MockupComponent = React.lazy(() => import('./MockupComponent'));

export interface MockupPayload {
  wireframePath: string;
  screenshotPath: string;
  altText?: string;
  width?: number;
  height?: number;
  key?: NodeKey;
}

export type SerializedMockupNode = Spread<
  {
    wireframePath: string;
    screenshotPath: string;
    altText: string;
    width?: number;
    height?: number;
  },
  SerializedLexicalNode
>;

function $convertMockupElement(domNode: Node): null | DOMConversionOutput {
  const element = domNode as HTMLElement;
  const wireframePath = element.getAttribute('data-wireframe-path');
  const screenshotPath = element.getAttribute('data-screenshot-path');
  const altText = element.getAttribute('data-alt-text') || 'Mockup';
  const width = element.getAttribute('data-width');
  const height = element.getAttribute('data-height');

  if (wireframePath && screenshotPath) {
    const node = $createMockupNode({
      wireframePath,
      screenshotPath,
      altText,
      width: width ? parseInt(width) : undefined,
      height: height ? parseInt(height) : undefined,
    });
    return { node };
  }

  return null;
}

export class MockupNode extends DecoratorNode<JSX.Element> {
  __wireframePath: string;
  __screenshotPath: string;
  __altText: string;
  __width: 'inherit' | number;
  __height: 'inherit' | number;

  static getType(): string {
    return 'mockup';
  }

  static clone(node: MockupNode): MockupNode {
    return new MockupNode(
      node.__wireframePath,
      node.__screenshotPath,
      node.__altText,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedMockupNode): MockupNode {
    const { wireframePath, screenshotPath, altText, width, height } =
      serializedNode;
    return $createMockupNode({
      wireframePath,
      screenshotPath,
      altText,
      width,
      height,
    });
  }

  constructor(
    wireframePath: string,
    screenshotPath: string,
    altText: string = 'Mockup',
    width?: 'inherit' | number,
    height?: 'inherit' | number,
    key?: NodeKey,
  ) {
    super(key);
    this.__wireframePath = wireframePath;
    this.__screenshotPath = screenshotPath;
    this.__altText = altText;
    this.__width = width || 'inherit';
    this.__height = height || 'inherit';
  }

  exportJSON(): SerializedMockupNode {
    return {
      ...super.exportJSON(),
      wireframePath: this.__wireframePath,
      screenshotPath: this.__screenshotPath,
      altText: this.__altText,
      width: this.__width === 'inherit' ? undefined : this.__width,
      height: this.__height === 'inherit' ? undefined : this.__height,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-lexical-mockup', 'true');
    element.setAttribute('data-wireframe-path', this.__wireframePath);
    element.setAttribute('data-screenshot-path', this.__screenshotPath);
    element.setAttribute('data-alt-text', this.__altText);
    if (this.__width !== 'inherit') {
      element.setAttribute('data-width', String(this.__width));
    }
    if (this.__height !== 'inherit') {
      element.setAttribute('data-height', String(this.__height));
    }

    // Include an img for visual representation in copy/paste
    const img = document.createElement('img');
    img.src = this.__screenshotPath;
    img.alt = this.__altText;
    if (this.__width !== 'inherit') {
      img.width = this.__width;
    }
    if (this.__height !== 'inherit') {
      img.height = this.__height;
    }
    element.appendChild(img);

    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-mockup')) {
          return null;
        }
        return {
          conversion: $convertMockupElement,
          priority: 1,
        };
      },
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    const theme = config.theme;
    const className = theme.mockup;
    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  updateDOM(): false {
    return false;
  }

  getWireframePath(): string {
    return this.__wireframePath;
  }

  getScreenshotPath(): string {
    return this.__screenshotPath;
  }

  getAltText(): string {
    return this.__altText;
  }

  setWidthAndHeight(
    width: 'inherit' | number,
    height: 'inherit' | number,
  ): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  setScreenshotPath(screenshotPath: string): void {
    const writable = this.getWritable();
    writable.__screenshotPath = screenshotPath;
  }

  decorate(): JSX.Element {
    return (
      <MockupComponent
        wireframePath={this.__wireframePath}
        screenshotPath={this.__screenshotPath}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        nodeKey={this.getKey()}
        resizable={true}
      />
    );
  }
}

export function $createMockupNode({
  wireframePath,
  screenshotPath,
  altText = 'Mockup',
  width,
  height,
  key,
}: MockupPayload): MockupNode {
  return $applyNodeReplacement(
    new MockupNode(wireframePath, screenshotPath, altText, width, height, key),
  );
}

export function $isMockupNode(
  node: LexicalNode | null | undefined,
): node is MockupNode {
  return node instanceof MockupNode;
}
