/**
 * Tool Packages Registry
 *
 * All available tool packages for Nimbalyst
 */

import { ToolPackage } from '../types/toolPackages';
import { CorePackage } from './CorePackage';
import { DeveloperPackage } from './DeveloperPackage';
import { ProductManagerPackage } from './ProductManagerPackage';

/**
 * All available tool packages
 */
export const ALL_PACKAGES: ToolPackage[] = [
  CorePackage,
  DeveloperPackage,
  ProductManagerPackage,
];

/**
 * Get a package by ID
 */
export function getPackageById(id: string): ToolPackage | undefined {
  return ALL_PACKAGES.find(pkg => pkg.id === id);
}

/**
 * Get multiple packages by IDs
 */
export function getPackagesByIds(ids: string[]): ToolPackage[] {
  return ids.map(id => getPackageById(id)).filter((pkg): pkg is ToolPackage => pkg !== undefined);
}

export { CorePackage, DeveloperPackage, ProductManagerPackage };
export * from '../types/toolPackages';
