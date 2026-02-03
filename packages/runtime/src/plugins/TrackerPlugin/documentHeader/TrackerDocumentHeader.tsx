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
  onContentChange,
  editor,
}) => {
  const [trackerData, setTrackerData] = useState<{ type: string; data: Record<string, any> } | null>(null);
  const [dataModel, setDataModel] = useState<TrackerDataModel | null>(null);

  // Detect tracker from frontmatter on mount
  useEffect(() => {
    const content = getContent();
    const detected = detectTrackerFromFrontmatter(content);
    setTrackerData(detected);

    if (detected) {
      // Load data model for tracker type
      const loadModel = async () => {
        try {
          const loader = ModelLoader.getInstance();
          const model = await loader.getModel(detected.type);
          setDataModel(model);
        } catch (error) {
          console.error(`[TrackerDocumentHeader] Failed to load model for type "${detected.type}":`, error);
          setDataModel(null);
        }
      };
      loadModel();
    } else {
      setDataModel(null);
    }
    // Only run on mount - we don't need to re-detect when content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
