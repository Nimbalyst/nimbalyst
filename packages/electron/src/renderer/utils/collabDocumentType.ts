interface CollabDocumentTypeRegistry {
  findMatchForFile(filePath: string): {
    key: string;
    registration: { collaboration?: { supported: boolean } };
  } | undefined;
}

/**
 * Derive the logical collab document type from a filename.
 *
 * Returns:
 * - `markdown` for `.md` / `.markdown`
 * - the full registered custom-editor suffix without the leading dot
 *   (e.g. `mockup.html` for `.mockup.html`)
 * - `null` when the file is not eligible for collaborative share
 */
export function deriveCollabDocumentType(
  fileName: string,
  registry: CollabDocumentTypeRegistry
): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';

  const match = registry.findMatchForFile(lower);
  if (!match?.registration.collaboration?.supported) return null;

  return match.key.startsWith('.') ? match.key.slice(1) : match.key;
}
