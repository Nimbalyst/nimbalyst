/**
 * Document Header System Exports
 */

export { DocumentHeaderRegistry } from './DocumentHeaderRegistry';
export type { DocumentHeaderProvider, DocumentHeaderComponentProps } from './DocumentHeaderRegistry';

export { DocumentHeaderContainer } from './DocumentHeaderContainer';
export { TrackerDocumentHeader, shouldRenderTrackerHeader } from './TrackerDocumentHeader';

export {
  extractFrontmatter,
  detectTrackerFromFrontmatter,
  updateFrontmatter,
  updateTrackerInFrontmatter,
} from './frontmatterUtils';
export type { TrackerFrontmatter } from './frontmatterUtils';
