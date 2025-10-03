/**
 * Constants for virtual documents
 */

import type { VirtualDocumentDescriptor } from '../documents/virtualDocTypes';

export const VIRTUAL_DOC_PROTOCOL = 'virtual://';

export const VIRTUAL_DOCS: Record<string, VirtualDocumentDescriptor> = {
  WELCOME: {
    id: 'welcome',
    title: 'Welcome to Preditor',
    assetPath: 'assets/welcome.md',
    virtualPath: `${VIRTUAL_DOC_PROTOCOL}welcome`,
  },
  PLANS: {
    id: 'plans',
    title: 'All Plans',
    assetPath: 'assets/plans.md',
    virtualPath: `${VIRTUAL_DOC_PROTOCOL}plans`,
  },
};

/**
 * Check if a path is a virtual document
 */
export function isVirtualPath(path: string): boolean {
  return path.startsWith(VIRTUAL_DOC_PROTOCOL);
}

/**
 * Get virtual document descriptor by path
 */
export function getVirtualDocByPath(path: string): VirtualDocumentDescriptor | undefined {
  return Object.values(VIRTUAL_DOCS).find(doc => doc.virtualPath === path);
}

/**
 * Get virtual document descriptor by id
 */
export function getVirtualDocById(id: string): VirtualDocumentDescriptor | undefined {
  return Object.values(VIRTUAL_DOCS).find(doc => doc.id === id);
}