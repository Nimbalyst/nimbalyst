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
  // Get current content from the editor
  // We get fresh content on mount and when providers need it
  const [content, setLocalContent] = React.useState(() => getContent());

  // Update content when getContent reference changes (editor content changed externally)
  // This is primarily for initial render - the content prop changes rarely
  React.useEffect(() => {
    const newContent = getContent();
    setLocalContent(newContent);
  }, [getContent]);

  // Re-query content after a short delay to handle the case where the editor
  // hasn't provided its getContent function yet on first render.
  // This is needed because getContent is a stable callback that reads from a ref,
  // and the ref may not be set when DocumentHeaderContainer first mounts.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const newContent = getContent();
      if (newContent) {
        setLocalContent(prev => prev !== newContent ? newContent : prev);
      }
    }, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get matching providers
  const providers = useMemo(() => {
    return DocumentHeaderRegistry.getProviders(content);
  }, [content]);

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
    content,
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
