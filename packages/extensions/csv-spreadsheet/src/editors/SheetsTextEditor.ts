/**
 * Custom text editor that behaves like Google Sheets:
 * - Arrow keys save and move to adjacent cell in that direction
 * - Enter saves and moves down
 * - Tab saves and moves right
 * - Escape cancels without saving
 */

import type { VNode, FunctionalUtilities } from '@stencil/core';
import type { EditCell, EditorBase, ColumnDataSchemaModel } from '@revolist/revogrid';

/**
 * Callback triggered on cell editor save
 * @param value - the value to save
 * @param preventFocus - if true, don't move focus to next cell
 */
export type SaveCallback = (value: unknown, preventFocus: boolean) => void;

/**
 * Callback to cancel editing (for Escape key)
 * @param focusNext - if true, focus next cell after cancel
 */
export type CancelCallback = (focusNext?: boolean) => void;

export class SheetsTextEditor implements EditorBase {
  editInput: HTMLInputElement | null = null;
  element: Element | null = null;
  editCell?: EditCell = undefined;

  constructor(
    public data: ColumnDataSchemaModel,
    private saveCallback?: SaveCallback,
    private cancelCallback?: CancelCallback,
  ) {}

  /**
   * Callback triggered on cell editor render
   */
  async componentDidRender(): Promise<void> {
    if (this.editInput) {
      // Small delay to ensure DOM is ready
      await new Promise(resolve => setTimeout(resolve, 0));
      this.editInput?.focus();
    }
  }

  onKeyDown(e: KeyboardEvent) {
    // Don't handle if composing (IME input)
    if (e.isComposing) return;

    const key = e.key;

    // Escape - cancel without saving
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.beforeDisconnect();
      this.cancelCallback?.(false);
      return;
    }

    // Enter - save and move down
    if (key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.beforeDisconnect();
      this.saveCallback?.(this.getValue(), false);
      return;
    }

    // Tab - save and move right
    if (key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      this.beforeDisconnect();
      this.saveCallback?.(this.getValue(), true);
      return;
    }

    // Let arrow keys work normally within the input for text editing
    // Don't intercept them - just let the user navigate within the text
  }

  /**
   * Prevent scroll glitches when editor is closed
   */
  beforeDisconnect() {
    this.editInput?.blur();
  }

  /**
   * Get value from input
   */
  getValue() {
    return this.editInput?.value ?? '';
  }

  /**
   * Render the editor input
   */
  render(createElement: FunctionalUtilities['h']): VNode | VNode[] {
    return createElement('input', {
      type: 'text',
      enterKeyHint: 'enter',
      value: this.editCell?.val ?? '',
      ref: (el: HTMLInputElement | null) => {
        this.editInput = el;
      },
      onKeyDown: (e: KeyboardEvent) => this.onKeyDown(e),
    });
  }
}
