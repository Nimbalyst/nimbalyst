/**
 * Enhanced TypeaheadMenu System
 *
 * Built from lessons learned analyzing Lexical's LexicalMenu implementation.
 * Key improvements over the original:
 *
 * 1. POSITIONING: Smart viewport-aware positioning that calculates available space
 *    in all directions, unlike the original which had issues near viewport edges
 *
 * 2. SCROLL HANDLING: Separates internal menu scrolling from external document scrolling
 *    to prevent the menu from closing when user scrolls within the menu options
 *
 * 3. ARCHITECTURE: Structured layout with dedicated header/footer areas and scrollable
 *    content, rather than the original's single render function approach
 *
 * 4. DYNAMIC SIZING: Automatically adapts menu height based on available viewport space
 *
 * 5. ENHANCED OPTIONS: Built-in support for keyboard shortcuts, descriptions, and
 *    flyout previews without requiring complex custom rendering
 */

import React, {ReactNode, useCallback, useEffect, useMemo, useRef, useState,} from 'react';
import {
  $getSelection,
  $isRangeSelection,
  createCommand,
  LexicalCommand,
  LexicalEditor,
  RangeSelection,
  TextNode,
} from 'lexical';

// ============================================================================
  // TYPES
  // ============================================================================

  export interface TypeaheadMenuOption {
    id: string;
    label: string;
    description?: string;
    /** Secondary text shown on the right side of the option (e.g., truncated path) */
    secondaryText?: string;
    shortcut?: string;
    icon?: ReactNode;
    preview?: ReactNode;
    keywords?: string[];
    onSelect: () => void;
    disabled?: boolean;
    type?: 'option' | 'header';
    section?: string; // New: automatically groups options by section
    hidden?: boolean; // Hide this option from the menu
    flag?: 'beta' | 'new' | 'experimental' | 'developer'; // Add visual flags to menu items
    /** Optional tooltip text shown on hover */
    tooltip?: string;
  }

  export interface TypeaheadMenuMatch {
    leadOffset: number;
    matchingString: string;
    replaceableString: string;
  }

  export interface TypeaheadMenuResolution {
    match?: TypeaheadMenuMatch;
    getRect: () => DOMRect;
  }

  export type TriggerFunction = (
    text: string,
    editor: LexicalEditor,
  ) => TypeaheadMenuMatch | null;


  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const PUNCTUATION = '\\.,\\+\\*\\?\\$\\@\\|#{}\\(\\)\\^\\-\\[\\]\\\\/!%\'"~=<>_:;';
  const MENU_VERTICAL_PADDING = 8;
  const MENU_HORIZONTAL_PADDING = 4;
  const VIEWPORT_PADDING = 10;

  // Commands for integration with Lexical's command system
  export const SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND: LexicalCommand<{
    index: number;
    option: TypeaheadMenuOption;
  }> = createCommand('SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND');

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Enhanced trigger function factory - improved from Lexical's useBasicTypeaheadTriggerMatch
   * Provides better character validation and customizable length constraints
   */
  export function createBasicTriggerFunction(
    trigger: string,
    { minLength = 1, maxLength = 75 }: { minLength?: number; maxLength?: number } = {}
  ): TriggerFunction {
    return (text: string) => {
      const validChars = '[^' + trigger + PUNCTUATION + '\\s]';
      const regex = new RegExp(
        '(^|\\s|\\()(' +
          '[' +
          trigger +
          ']' +
          '((?:' +
          validChars +
          '){0,' +
          maxLength +
          '})' +
          ')$',
      );
      const match = regex.exec(text);
      if (match !== null) {
        const maybeLeadingWhitespace = match[1];
        const matchingString = match[3];
        if (matchingString.length >= minLength) {
          return {
            leadOffset: match.index + maybeLeadingWhitespace.length,
            matchingString,
            replaceableString: match[2],
          };
        }
      }
      return null;
    };
  }

  /**
   * Get text content up to cursor position
   * Learned from Lexical's getTextUpToAnchor but with better error handling
   */
  export function getTextUpToAnchor(selection: RangeSelection): string | null {
    const anchor = selection.anchor;
    if (anchor.type !== 'text') {
      return null;
    }
    const anchorNode = anchor.getNode();
    const anchorOffset = anchor.offset;
    return anchorNode.getTextContent().slice(0, anchorOffset);
  }

  /**
   * Split text node containing the query - enhanced from Lexical's $splitNodeContainingQuery
   * with better offset calculation and error handling
   */
  export function splitNodeContainingQuery(match: TypeaheadMenuMatch): TextNode | null {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return null;
    }
    const anchor = selection.anchor;
    if (anchor.type !== 'text') {
      return null;
    }
    const anchorNode = anchor.getNode();
    if (!anchorNode.isSimpleText()) {
      return null;
    }
    const selectionOffset = anchor.offset;
    const textContent = anchorNode.getTextContent().slice(0, selectionOffset);
    const characterOffset = match.replaceableString.length;
    const queryOffset = getFullMatchOffset(
      textContent,
      match.matchingString,
      characterOffset,
    );
    const startOffset = selectionOffset - queryOffset;
    if (startOffset < 0) {
      return null;
    }
    let newNode;
    if (startOffset === 0) {
      [newNode] = anchorNode.splitText(selectionOffset);
    } else {
      [, newNode] = anchorNode.splitText(startOffset, selectionOffset);
    }
    return newNode;
  }

  /**
   * Enhanced match offset calculation from Lexical's getFullMatchOffset
   */
  export function getFullMatchOffset(
    documentText: string,
    entryText: string,
    offset: number,
  ): number {
    let triggerOffset = offset;
    for (let i = triggerOffset; i <= entryText.length; i++) {
      if (documentText.slice(-i) === entryText.substring(0, i)) {
        triggerOffset = i;
      }
    }
    return triggerOffset;
  }

  /**
   * Smart positioning system - major improvement over Lexical's positioning
   * Calculates optimal position considering all viewport constraints
   */
  export interface PositionResult {
    top: number;
    left: number;
    maxHeight: number;
    placement: 'above' | 'below';
  }

  export function calculateOptimalPosition(
    anchorRect: DOMRect,
    menuWidth: number,
    menuHeight: number,
    maxHeight?: number,
  ): PositionResult {
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    // Calculate available space in each direction
    const spaceAbove = anchorRect.top - VIEWPORT_PADDING;
    const spaceBelow = viewport.height - anchorRect.bottom - VIEWPORT_PADDING;
    const spaceLeft = anchorRect.left - VIEWPORT_PADDING;
    const spaceRight = viewport.width - anchorRect.right - VIEWPORT_PADDING;

    // Determine vertical placement
    const preferBelow = spaceBelow >= spaceAbove;
    const availableHeight = preferBelow ? spaceBelow : spaceAbove;
    const constrainedHeight = Math.min(
      menuHeight,
      maxHeight || Number.MAX_SAFE_INTEGER,
      availableHeight
    );

    // Calculate vertical position
    let top: number;
    let placement: 'above' | 'below';
    if (preferBelow && spaceBelow >= constrainedHeight) {
      top = anchorRect.bottom + window.pageYOffset;
      placement = 'below';
    } else if (spaceAbove >= constrainedHeight) {
      top = anchorRect.top - constrainedHeight + window.pageYOffset;
      placement = 'above';
    } else {
      // Not enough space in either direction, choose the larger space
      if (spaceBelow > spaceAbove) {
        top = anchorRect.bottom + window.pageYOffset;
        placement = 'below';
      } else {
        top = VIEWPORT_PADDING + window.pageYOffset;
        placement = 'above';
      }
    }

    // Calculate horizontal position
    let left = anchorRect.left + window.pageXOffset;

    // Adjust if menu would overflow viewport
    if (left + menuWidth > viewport.width - VIEWPORT_PADDING) {
      left = viewport.width - menuWidth - VIEWPORT_PADDING + window.pageXOffset;
    }
    if (left < VIEWPORT_PADDING) {
      left = VIEWPORT_PADDING + window.pageXOffset;
    }

    return {
      top,
      left,
      maxHeight: constrainedHeight,
      placement,
    };
  }

  /**
   * Enhanced scroll parent detection from Lexical's getScrollParent
   */
  export function getScrollParent(element: HTMLElement): HTMLElement | HTMLBodyElement {
    let style = getComputedStyle(element);
    const excludeStaticParent = style.position === 'absolute';
    const overflowRegex = /(auto|scroll)/;

    if (style.position === 'fixed') {
      return document.body;
    }

    for (let parent: HTMLElement | null = element; (parent = parent.parentElement); ) {
      style = getComputedStyle(parent);
      if (excludeStaticParent && style.position === 'static') {
        continue;
      }
      if (overflowRegex.test(style.overflow + style.overflowY + style.overflowX)) {
        return parent;
      }
    }
    return document.body;
  }

  // ============================================================================
  // MENU OPTION COMPONENT
  // ============================================================================

  export interface MenuOptionProps {
    option: TypeaheadMenuOption;
    isSelected: boolean;
    onClick: () => void;
    onMouseEnter: () => void;
    className?: string;
    selectedClassName?: string;
  }

  const MenuOption: React.FC<MenuOptionProps> = ({
    option,
    isSelected,
    onClick,
    onMouseEnter,
    className = '',
    selectedClassName = '',
  }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (isSelected && ref.current) {
        // Find the scrollable container WITHIN the typeahead menu only
        // Stop at .typeahead-menu to avoid scrolling the document
        let scrollContainer: HTMLElement | null = ref.current.parentElement;
        while (scrollContainer) {
          // Stop if we've reached the menu boundary
          if (scrollContainer.classList.contains('typeahead-menu')) {
            scrollContainer = null;
            break;
          }
          const style = getComputedStyle(scrollContainer);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            break;
          }
          scrollContainer = scrollContainer.parentElement;
        }

        // Manually scroll the container instead of using scrollIntoView
        // scrollIntoView scrolls ALL ancestors, which can scroll the editor
        if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
          const optionRect = ref.current.getBoundingClientRect();
          const containerRect = scrollContainer.getBoundingClientRect();

          if (optionRect.bottom > containerRect.bottom) {
            // Option is below visible area - scroll down
            scrollContainer.scrollTop += optionRect.bottom - containerRect.bottom;
          } else if (optionRect.top < containerRect.top) {
            // Option is above visible area - scroll up
            scrollContainer.scrollTop -= containerRect.top - optionRect.top;
          }
        }
      }
    }, [isSelected]);

    // Render header differently
    if (option.type === 'header') {
      return (
        <div
          ref={ref}
          className={`typeahead-menu-header ${className}`}
          role="presentation"
          style={{
            padding: '8px 12px',
            backgroundColor: 'var(--surface-tertiary, #f5f5f5)',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-secondary, #666)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            margin: '0',
            pointerEvents: 'none',
          }}
        >
          {option.label}
        </div>
      );
    }

    // Use single-line layout when secondaryText is provided (no description shown)
    const useSingleLineLayout = !!option.secondaryText;

    return (
      <div
        ref={ref}
        className={`typeahead-menu-option ${className} ${isSelected ? selectedClassName : ''}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        role="option"
        aria-selected={isSelected}
        title={option.tooltip}
        style={{
          padding: '6px 10px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: option.disabled ? 0.5 : 1,
          pointerEvents: option.disabled ? 'none' : 'auto',
          backgroundColor: isSelected ? 'var(--surface-selected, #f0f0f0)' : 'transparent',
          borderRadius: '4px',
          margin: '2px 4px',
          fontSize: '0.9rem',
          color: 'var(--text-primary, #111)',
          gap: '8px',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          minWidth: 0, // Allow truncation
          overflow: 'hidden',
        }}>
          {option.icon && (
            <span style={{ marginRight: '8px', flexShrink: 0 }}>{option.icon}</span>
          )}
          <div style={{
            flex: 1,
            minWidth: 0, // Allow truncation
            overflow: 'hidden',
          }}>
            <div style={{
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {option.label}
              </span>
              {option.flag && (
                <span style={{
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  color: option.flag === 'beta' ? '#ff6b35' : option.flag === 'new' ? '#00c851' : option.flag === 'developer' ? '#6f42c1' : '#ff4444',
                  backgroundColor: option.flag === 'beta' ? '#fff3f0' : option.flag === 'new' ? '#f0fff4' : option.flag === 'developer' ? '#f8f5ff' : '#fff0f0',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px',
                  border: `1px solid ${option.flag === 'beta' ? '#ff6b35' : option.flag === 'new' ? '#00c851' : option.flag === 'developer' ? '#6f42c1' : '#ff4444'}`,
                  flexShrink: 0,
                }}>
                  {option.flag}
                </span>
              )}
            </div>
            {!useSingleLineLayout && option.description && (
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #666)', marginTop: '2px' }}>
                {option.description}
              </div>
            )}
          </div>
        </div>
        {/* Secondary text (e.g., truncated path) shown on the right */}
        {option.secondaryText && (
          <span style={{
            fontSize: '0.8rem',
            color: 'var(--text-tertiary, #71717a)',
            flexShrink: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '50%',
            textAlign: 'right',
          }}>
            {option.secondaryText}
          </span>
        )}
        {option.shortcut && (
          <span style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary, #999)',
            backgroundColor: 'var(--surface-tertiary, #f5f5f5)',
            padding: '2px 6px',
            borderRadius: '3px',
            fontFamily: 'monospace',
            flexShrink: 0,
          }}>
            {option.shortcut}
          </span>
        )}
      </div>
    );
  };

  // ============================================================================
  // UTILITY FUNCTIONS FOR SECTIONS
  // ============================================================================

  /**
   * Groups options by their section property
   * @param options - Array of options with optional section property
   * @returns Object mapping section names to arrays of options
   */
  export function groupOptionsBySection(options: TypeaheadMenuOption[]): Record<string, TypeaheadMenuOption[]> {
    const groups: Record<string, TypeaheadMenuOption[]> = {};
    
    for (const option of options) {
      const section = option.section || '_default';
      if (!groups[section]) {
        groups[section] = [];
      }
      groups[section].push(option);
    }
    
    return groups;
  }

  /**
   * Filters options based on query, including section names in search
   * @param options - Array of options to filter
   * @param query - Search query
   * @param searchFields - Fields to search in options
   * @returns Filtered options
   */
  export function filterOptionsWithSections(
    options: TypeaheadMenuOption[], 
    query: string,
    searchFields: Array<keyof TypeaheadMenuOption> = ['label', 'description', 'keywords', 'section']
  ): TypeaheadMenuOption[] {
    // First filter out hidden options
    const visibleOptions = options.filter(option => !option.hidden);
    
    if (!query.trim()) {
      return visibleOptions;
    }

    const regex = new RegExp(query, 'i');
    
    return visibleOptions.filter(option => {
      return searchFields.some(field => {
        const value = option[field];
        if (Array.isArray(value)) {
          return value.some(item => regex.test(String(item)));
        }
        return value && regex.test(String(value));
      });
    });
  }

  // ============================================================================
  // MAIN MENU COMPONENT
  // ============================================================================

  export const TypeaheadMenuContent: React.FC<{
    resolution: TypeaheadMenuResolution;
    options: TypeaheadMenuOption[];
    selectedIndex: number | null;
    onSelectOption: (option: TypeaheadMenuOption) => void;
    onSetSelectedIndex: (index: number) => void;
    header?: ReactNode;
    footer?: ReactNode;
    maxHeight?: number;
    minWidth?: number;
    maxWidth?: number;
    className?: string;
    optionClassName?: string;
    selectedOptionClassName?: string;
    anchorElem?: HTMLElement | null;
  }> = ({
    resolution,
    options,
    selectedIndex,
    onSelectOption,
    onSetSelectedIndex,
    header,
    footer,
    maxHeight = 500,
    minWidth = 250,
    maxWidth = 400,
    className = '',
    optionClassName = '',
    selectedOptionClassName = '',
    anchorElem,
  }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<PositionResult | null>(null);
    const [isMeasured, setIsMeasured] = useState(false);
    // Track whether mouse interaction is enabled.
    // This prevents auto-selection when the menu opens under the cursor.
    const [mouseInteractionEnabled, setMouseInteractionEnabled] = useState(false);

    // Disable mouse interaction when menu opens, then enable after a brief delay
    // This prevents the initial mouseenter from selecting the wrong item
    useEffect(() => {
      if (position) {
        setMouseInteractionEnabled(false);
        const timer = setTimeout(() => {
          setMouseInteractionEnabled(true);
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [position !== null]);

    // Only allow hover selection after mouse interaction is enabled
    const handleOptionMouseEnter = useCallback((index: number) => {
      if (mouseInteractionEnabled) {
        onSetSelectedIndex(index);
      }
    }, [mouseInteractionEnabled, onSetSelectedIndex]);

    // Group options by section
    const groupedOptions = useMemo(() => {
      return groupOptionsBySection(options);
    }, [options]);

    // Get section names in order (with _default last)
    const sectionNames = useMemo(() => {
      const names = Object.keys(groupedOptions).filter(name => name !== '_default');
      names.sort(); // Alphabetical order
      if (groupedOptions._default) {
        names.push('_default');
      }
      return names;
    }, [groupedOptions]);

    // Get the option at the selected index
    const selectedOption = selectedIndex !== null ? options[selectedIndex] : null;

    // Calculate position whenever resolution changes
    useEffect(() => {
      if (resolution && menuRef.current) {
        // Use setTimeout to ensure DOM has updated with new options
        const timeoutId = setTimeout(() => {
          if (menuRef.current) {
            // Temporarily remove height constraint to measure natural height
            const originalMaxHeight = menuRef.current.style.maxHeight;
            menuRef.current.style.maxHeight = 'none';

            const anchorRect = resolution.getRect();
            const menuRect = menuRef.current.getBoundingClientRect();

            // Restore the height constraint
            menuRef.current.style.maxHeight = originalMaxHeight;

            const newPosition = calculateOptimalPosition(
              anchorRect,
              Math.max(minWidth, Math.min(maxWidth, menuRect.width)),
              menuRect.height, // Use the natural height
              maxHeight
            );
            if (anchorElem && anchorElem !== document.body) {
              // POSITIONING: The menu is portaled into anchorElem (editor-scroller) which has
              // position: relative and overflow: auto. To position correctly:
              // 1. Use viewport coordinates from calculateOptimalPosition
              // 2. Subtract containerRect to get position relative to anchorElem
              // 3. Add anchorElem.scrollTop/Left to account for scroll offset within anchorElem
              // This ensures the menu scrolls with content and appears at the correct position.
              const containerRect = anchorElem.getBoundingClientRect();
              const anchoredTop = Math.max(0, newPosition.top - window.pageYOffset - containerRect.top + anchorElem.scrollTop);
              const anchoredLeft = Math.max(0, newPosition.left - window.pageXOffset - containerRect.left + anchorElem.scrollLeft);
              const anchoredMaxHeight = Math.max(120, Math.min(newPosition.maxHeight, containerRect.height - 16));
              setPosition({
                ...newPosition,
                top: anchoredTop,
                left: anchoredLeft,
                maxHeight: anchoredMaxHeight,
              });
            } else {
              setPosition(newPosition);
            }
            setIsMeasured(true);
          }
        }, 0);

        return () => clearTimeout(timeoutId);
      }
    }, [resolution, maxHeight, minWidth, maxWidth, options, anchorElem]);

    // Determine if menu should be visible based on measurement state
    const isVisible = isMeasured && position;
    const menuStyle: React.CSSProperties = isVisible
      ? {
          position: 'absolute',
          top: `${position.top}px`,
          left: `${position.left}px`,
          minWidth: `${minWidth}px`,
          maxWidth: `${maxWidth}px`,
          maxHeight: `${position.maxHeight}px`,
          backgroundColor: 'var(--surface-primary, white)',
          border: '1px solid var(--border-primary, #ccc)',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }
      : {
          position: 'absolute',
          top: -9999,
          left: -9999,
          visibility: 'hidden',
          pointerEvents: 'none',
          minWidth: `${minWidth}px`,
          maxWidth: `${maxWidth}px`,
          maxHeight: `${maxHeight}px`,
          backgroundColor: 'var(--surface-primary, white)',
          border: '1px solid var(--border-primary, #ccc)',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        };

    return (
      <div
        ref={menuRef}
        className={`typeahead-menu ${className}`}
        role={isVisible ? "listbox" : undefined}
        style={menuStyle}
        // Prevent menu from closing when clicking inside
        onMouseDown={isVisible ? (e) => e.preventDefault() : undefined}
      >
        {header && (
          <div style={{
            borderBottom: '1px solid var(--border-primary, #eee)',
            padding: '6px 10px',
            flexShrink: 0,
          }}>
            {header}
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 0',
          }}
          // Critical: Stop propagation of scroll events to prevent menu closure
          onScroll={(e) => e.stopPropagation()}
        >
          {sectionNames.length > 1 || (sectionNames.length === 1 && sectionNames[0] !== '_default') ? (
            sectionNames.map(sectionName => {
              const sectionOptions = groupedOptions[sectionName];
              if (!sectionOptions || sectionOptions.length === 0) return null;
              
              return (
                <div key={sectionName} className="typeahead-section">
                  {sectionName !== '_default' && (
                    <div
                      className="typeahead-section-header"
                      style={{
                        padding: '6px 10px',
                        backgroundColor: 'var(--surface-tertiary, #f5f5f5)',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: 'var(--text-secondary, #666)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        margin: '0',
                        pointerEvents: 'none',
                      }}
                    >
                      {sectionName}
                    </div>
                  )}
                  {sectionOptions.map((option) => {
                    // Find this option's index in the flat array
                    const flatIndex = options.findIndex(opt => opt.id === option.id);

                    return (
                      <MenuOption
                        key={option.id}
                        option={option}
                        isSelected={selectedOption?.id === option.id}
                        onClick={() => option.type !== 'header' && onSelectOption(option)}
                        onMouseEnter={() => option.type !== 'header' && flatIndex >= 0 && handleOptionMouseEnter(flatIndex)}
                        className={optionClassName}
                        selectedClassName={selectedOptionClassName}
                      />
                    );
                  })}
                </div>
              );
            })
          ) : (
            options.map((option, index) => (
              <MenuOption
                key={option.id}
                option={option}
                isSelected={selectedIndex === index}
                onClick={() => option.type !== 'header' && onSelectOption(option)}
                onMouseEnter={() => option.type !== 'header' && handleOptionMouseEnter(index)}
                className={optionClassName}
                selectedClassName={selectedOptionClassName}
              />
            ))
          )}
          {options.length === 0 && (
            <div style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--text-tertiary, #999)',
              fontStyle: 'italic'
            }}>
              No matches found
            </div>
          )}
        </div>

          {footer && (
          <div style={{
            borderTop: '1px solid var(--border-primary, #eee)',
            padding: '6px 10px',
            flexShrink: 0,
          }}>
            {footer}
          </div>
          )}
      </div>
    );
  };
