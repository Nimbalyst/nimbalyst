/**
 * File utility functions
 */

/**
 * Converts a filename to a human-readable title
 * - Removes file extension (.md, .markdown)
 * - Replaces dashes and underscores with spaces
 * - Capitalizes the first letter of each word
 *
 * @param fileName - The filename to convert
 * @returns Formatted title string
 *
 * @example
 * formatFileNameAsTitle('my-new-document.md') // 'My New Document'
 * formatFileNameAsTitle('test_file.md') // 'Test File'
 * formatFileNameAsTitle('README.md') // 'README'
 */
export function formatFileNameAsTitle(fileName: string): string {
  // Remove .md or .markdown extension
  const nameWithoutExt = fileName.replace(/\.(md|markdown)$/i, '');

  // Replace dashes and underscores with spaces
  const withSpaces = nameWithoutExt.replace(/[-_]/g, ' ');

  // Capitalize first letter of each word
  const capitalized = withSpaces
    .split(' ')
    .map(word => {
      if (word.length === 0) return word;
      // Keep acronyms in all caps (e.g., README, API)
      if (word === word.toUpperCase() && word.length > 1) {
        return word;
      }
      // Capitalize first letter, lowercase the rest
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  return capitalized;
}

/**
 * Checks if a filename has a markdown extension
 *
 * @param fileName - The filename to check
 * @returns True if the file is a markdown file
 */
export function isMarkdownFile(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

/**
 * Creates initial content for a new file.
 * Only adds a markdown title heading for markdown files.
 *
 * @param fileName - The filename to use for the title
 * @returns Initial content (markdown heading for .md/.markdown files, empty string otherwise)
 */
export function createInitialFileContent(fileName: string): string {
  if (!isMarkdownFile(fileName)) {
    return '';
  }
  const title = formatFileNameAsTitle(fileName);
  return `# ${title}\n\n`;
}
