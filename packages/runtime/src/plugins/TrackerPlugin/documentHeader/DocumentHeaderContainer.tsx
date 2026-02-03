/**
 * DocumentHeaderContainer - Renders all registered document headers
 *
 * This component:
 * - Queries the DocumentHeaderRegistry for matching providers
 * - Renders all matching header components
 * - Passes document context to each header
 */

import React, { useMemo, useEffect } from 'react';
import { DocumentHeaderRegistry } from './DocumentHeaderRegistry';
import type { DocumentHeaderComponentProps } from './DocumentHeaderRegistry';

interface DocumentHeaderContainerProps {
  filePath: string;
  fileName: string;
  /** Callback to get current content from the editor. Called on mount and when providers need fresh content. */
  getContent: () => string;
  onContentChange?: (newContent: string) => void;
  editor?: any;
}

export const DocumentHeaderContainer: React.FC<DocumentHeaderContainerProps> = ({
  filePath,
  fileName,
  getContent,
  onContentChange,
  editor,
}) => {
  // Track content only for provider matching - components get fresh content via getContent
  const [contentForMatching, setContentForMatching] = React.useState(() => getContent());

  // Re-query content after a short delay to handle the case where the editor
  // hasn't provided its getContent function yet on first render.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const newContent = getContent();
      if (newContent) {
        setContentForMatching(prev => prev !== newContent ? newContent : prev);
      }
    }, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get matching providers based on content structure (frontmatter detection)
  const providers = useMemo(() => {
    return DocumentHeaderRegistry.getProviders(contentForMatching);
  }, [contentForMatching]);

  // Expose onContentChange handler globally for commands to access
  useEffect(() => {
    if (onContentChange) {
      (window as any).__documentContentChangeHandler = onContentChange;
    }
    return () => {
      delete (window as any).__documentContentChangeHandler;
    };
  }, [onContentChange]);

  if (providers.length === 0) {
    return null;
  }

  const componentProps: DocumentHeaderComponentProps = {
    filePath,
    fileName,
    getContent,
    onContentChange,
    editor,
  };

  return (
    <div className="document-header-container w-full bg-[var(--nim-bg)] border-b border-[var(--nim-border)]">
      {providers.map(provider => {
        const Component = provider.component;
        return <Component key={provider.id} {...componentProps} />;
      })}
    </div>
  );
};
