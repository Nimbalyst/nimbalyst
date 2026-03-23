/**
 * Built-in nim-* Component Library
 *
 * Collects all component source strings into a single injection payload.
 * Components are defined as raw JavaScript strings because they need
 * to be injected into mockup iframes via <script> tags.
 */

import { NIM_BUTTON_SRC } from './nim-button';
import { NIM_INPUT_SRC } from './nim-input';
import { NIM_CARD_SRC } from './nim-card';
import { NIM_TABS_SRC } from './nim-tabs';
import { NIM_DIALOG_SRC } from './nim-dialog';
import { NIM_LIST_SRC } from './nim-list';
import { NIM_ICON_SRC } from './nim-icon';
import { NIM_SELECT_SRC } from './nim-select';
import { NIM_TOGGLE_SRC } from './nim-toggle';
import { NIM_AVATAR_SRC } from './nim-avatar';
import { NIM_ACCORDION_SRC } from './nim-accordion';
import { NIM_DROPDOWN_SRC } from './nim-dropdown';
import { NIM_TREE_SRC } from './nim-tree';
import { NIM_BADGE_SRC } from './nim-badge';
import { NIM_TOOLTIP_SRC } from './nim-tooltip';

/**
 * All built-in component sources concatenated into a single script.
 * This gets injected once into each mockup iframe.
 */
export const BUILTIN_COMPONENTS_SCRIPT = [
  NIM_BUTTON_SRC,
  NIM_INPUT_SRC,
  NIM_CARD_SRC,
  NIM_TABS_SRC,
  NIM_DIALOG_SRC,
  NIM_LIST_SRC,
  NIM_ICON_SRC,
  NIM_SELECT_SRC,
  NIM_TOGGLE_SRC,
  NIM_AVATAR_SRC,
  NIM_ACCORDION_SRC,
  NIM_DROPDOWN_SRC,
  NIM_TREE_SRC,
  NIM_BADGE_SRC,
  NIM_TOOLTIP_SRC,
].join('\n');

/**
 * List of all registered component tag names.
 */
export const BUILTIN_COMPONENT_TAGS = [
  'nim-button',
  'nim-input',
  'nim-card',
  'nim-tabs',
  'nim-dialog',
  'nim-list',
  'nim-icon',
  'nim-select',
  'nim-toggle',
  'nim-avatar',
  'nim-accordion',
  'nim-dropdown',
  'nim-tree',
  'nim-badge',
  'nim-tooltip',
] as const;
