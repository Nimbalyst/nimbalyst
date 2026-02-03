/**
 * TrackerDocumentHeader - Renders tracker status bar for full-document tracking
 *
 * This component:
 * - Detects tracker frontmatter in document content
 * - Loads the appropriate tracker data model
 * - Renders the StatusBar component with tracker data
 * - Updates frontmatter when fields change
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { StatusBar } from '../components/StatusBar';
import { ModelLoader } from '../models/ModelLoader';
import type { TrackerDataModel } from '../models/TrackerDataModel';
import { detectTrackerFromFrontmatter, updateTrackerInFrontmatter } from './frontmatterUtils';
import type { DocumentHeaderComponentProps } from './DocumentHeaderRegistry';

export const TrackerDocumentHeader: React.FC<DocumentHeaderComponentProps> = ({
  filePath,
  fileName,
  getContent,
  contentVersion,
  onContentChange,
  editor,
}) => {
  const [dataModel, setDataModel] = useState<TrackerDataModel | null>(null);
  const [trackerType, setTrackerType] = useState<string | null>(null);

  // Get fresh tracker data when contentVersion changes
  const trackerData = useMemo(() => {
    const content = getContent();
    return detectTrackerFromFrontmatter(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContent, contentVersion]);

  // Load data model when tracker type changes (or on mount)
  useEffect(() => {
    const currentType = trackerData?.type ?? null;

    // Only reload model if type changed
    if (currentType === trackerType) return;
    setTrackerType(currentType);

    if (currentType) {
      const loadModel = async () => {
        try {
          const loader = ModelLoader.getInstance();
          const model = await loader.getModel(currentType);
          setDataModel(model);
        } catch (error) {
          console.error(`[TrackerDocumentHeader] Failed to load model for type "${currentType}":`, error);
          setDataModel(null);
        }
      };
      loadModel();
    } else {
      setDataModel(null);
    }
  }, [trackerData?.type, trackerType]);

  // Handle field changes - get fresh content at the moment of change
  const handleChange = useCallback((updates: Record<string, any>) => {
    if (!trackerData || !onContentChange) return;

    // Get fresh content and update with new frontmatter
    const currentContent = getContent();
    const updatedContent = updateTrackerInFrontmatter(currentContent, trackerData.type, updates);
    onContentChange(updatedContent);
  }, [getContent, trackerData, onContentChange]);

  // Don't render if no tracker data or no data model
  if (!trackerData || !dataModel) {
    return null;
  }

  return (
    <div className="document-header-tracker">
      <StatusBar
        model={dataModel}
        data={trackerData.data}
        onChange={handleChange}
      />
    </div>
  );
};

/**
 * Helper function to check if content should render tracker header
 */
export function shouldRenderTrackerHeader(content: string): boolean {
  const detected = detectTrackerFromFrontmatter(content);
  return detected !== null;
}
