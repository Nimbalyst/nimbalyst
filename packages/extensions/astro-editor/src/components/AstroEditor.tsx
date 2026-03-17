/**
 * Astro Editor - Main editor component.
 *
 * Provides a schema-aware form view for editing .astro file frontmatter,
 * with source mode toggle for raw editing via Monaco.
 *
 * Uses useEditorLifecycle for load/save/echo detection lifecycle.
 * Content state lives in a ref (not React state) to avoid unnecessary re-renders.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEditorLifecycle, type EditorHostProps } from '@nimbalyst/extension-sdk';
import { parseAstroFile, serializeAstroFile, extractTemplateSummary } from '../schema/astroParser';
import type { AstroFileParts } from '../schema/astroParser';
import type { CollectionSchema } from '../schema/types';
import { discoverSchemas, detectCollectionFromPath } from '../schema/discovery';
import { FrontmatterForm } from './FrontmatterForm';
import { TemplateSummary } from './TemplateSummary';

export function AstroEditor({ host }: EditorHostProps) {
  const { filePath } = host;

  // Content state in a ref -- React updates triggered by forceRender
  const partsRef = useRef<AstroFileParts | null>(null);
  const [, forceRender] = useState(0);

  const [schema, setSchema] = useState<CollectionSchema | null>(null);
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([]);

  // useEditorLifecycle handles: loading, saving, echo detection, file changes, theme
  const { markDirty, isLoading, error, theme } = useEditorLifecycle<AstroFileParts>(host, {
    parse: (raw: string): AstroFileParts => parseAstroFile(raw),

    serialize: (parts: AstroFileParts): string => {
      return parts.frontmatterData
        ? serializeAstroFile(parts.frontmatterData, parts.template)
        : `---\n${parts.rawFrontmatter}\n---\n${parts.template}`;
    },

    applyContent: (parsed: AstroFileParts) => {
      partsRef.current = parsed;
      forceRender((n) => n + 1);
    },

    getCurrentContent: () => partsRef.current!,
  });

  // Get filesystem services for schema discovery
  const extensionServices = useMemo(() => {
    const hostExtensions = (window as any).__nimbalyst_extensions;
    return hostExtensions?.['@nimbalyst/extension-services'] ?? null;
  }, []);

  // Discover schema for this file
  useEffect(() => {
    if (!host.workspaceId || !extensionServices?.filesystem) return;

    const workspacePath = host.workspaceId;
    const collectionName = detectCollectionFromPath(filePath, workspacePath);

    if (!collectionName) {
      setSchema(null);
      return;
    }

    let mounted = true;

    discoverSchemas(workspacePath, extensionServices.filesystem)
      .then((result) => {
        if (!mounted) return;
        const found = result.collections.find((c) => c.name === collectionName);
        setSchema(found ?? null);
        setSchemaWarnings(result.warnings);
      })
      .catch(() => {
        if (mounted) setSchema(null);
      });

    return () => {
      mounted = false;
    };
  }, [filePath, host.workspaceId, extensionServices]);

  // Handle frontmatter changes from the form
  const handleFrontmatterChange = useCallback(
    (updates: Record<string, unknown>) => {
      const prev = partsRef.current;
      if (!prev) return;
      partsRef.current = {
        ...prev,
        frontmatterData: updates,
        rawFrontmatter: '',
      };
      forceRender((n) => n + 1);
      markDirty();
    },
    [markDirty]
  );

  const parts = partsRef.current;

  // Template summary
  const templateSummary = useMemo(() => {
    if (!parts?.template) return null;
    return extractTemplateSummary(parts.template);
  }, [parts?.template]);

  if (isLoading) {
    return (
      <div className="astro-editor" data-theme={theme}>
        <div className="astro-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="astro-editor" data-theme={theme}>
        <div className="astro-error">
          Failed to load: {error.message}
        </div>
      </div>
    );
  }

  if (!parts?.hasFrontmatter || !parts.frontmatterData) {
    return (
      <div className="astro-editor" data-theme={theme}>
        <div className="astro-no-frontmatter">
          <div className="astro-no-frontmatter-message">
            This file has no editable frontmatter.
          </div>
          <div className="astro-no-frontmatter-hint">
            Use source mode to edit the raw file content.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="astro-editor" data-theme={theme}>
      {schemaWarnings.length > 0 && (
        <div className="astro-warnings">
          {schemaWarnings.map((w, i) => (
            <div key={i} className="astro-warning">{w}</div>
          ))}
        </div>
      )}

      <div className="astro-editor-content">
        <FrontmatterForm
          data={parts.frontmatterData}
          schema={schema}
          onChange={handleFrontmatterChange}
        />

        {templateSummary && <TemplateSummary summary={templateSummary} />}
      </div>
    </div>
  );
}
