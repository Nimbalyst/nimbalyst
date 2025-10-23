/**
 * DocumentHeaderContainer - Renders all registered document headers
 *
 * This component:
 * - Queries the DocumentHeaderRegistry for matching providers
 * - Renders all matching header components
 * - Passes document context to each header
 */

import React, { useMemo } from 'react';
import { DocumentHeaderRegistry } from './DocumentHeaderRegistry';
import type { DocumentHeaderComponentProps } from './DocumentHeaderRegistry';
import './DocumentHeader.css';

interface DocumentHeaderContainerProps {
  filePath: string;
  fileName: string;
  content: string;
  onContentChange?: (newContent: string) => void;
  editor?: any;
}

export const DocumentHeaderContainer: React.FC<DocumentHeaderContainerProps> = ({
  filePath,
  fileName,
  content,
  onContentChange,
  editor,
}) => {
  // Get matching providers
  const providers = useMemo(() => {
    return DocumentHeaderRegistry.getProviders(content);
  }, [content]);

  if (providers.length === 0) {
    return null;
  }

  const componentProps: DocumentHeaderComponentProps = {
    filePath,
    fileName,
    content,
    onContentChange,
    editor,
  };

  return (
    <div className="document-header-container">
      {providers.map(provider => {
        const Component = provider.component;
        return <Component key={provider.id} {...componentProps} />;
      })}
    </div>
  );
};
