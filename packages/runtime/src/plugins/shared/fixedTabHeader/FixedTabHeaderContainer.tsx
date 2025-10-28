import { useEffect, useState } from 'react';
import type { LexicalEditor } from 'lexical';
import { FixedTabHeaderRegistry } from './FixedTabHeaderRegistry';
import type { FixedTabHeaderProvider, TabContext } from './types';
import './FixedTabHeader.css';

interface FixedTabHeaderContainerProps {
  filePath: string;
  fileName: string;
  editor?: LexicalEditor;
}

export function FixedTabHeaderContainer({
  filePath,
  fileName,
  editor,
}: FixedTabHeaderContainerProps) {
  const [providers, setProviders] = useState<FixedTabHeaderProvider[]>([]);

  useEffect(() => {
    const context: TabContext = {
      filePath,
      fileName,
      editor,
    };

    const registry = FixedTabHeaderRegistry.getInstance();
    const activeProviders = registry.getProviders(context);
    setProviders(activeProviders);

    if (!editor) return;

    const removeUpdateListener = editor.registerUpdateListener(() => {
      const updatedProviders = registry.getProviders(context);
      setProviders(updatedProviders);
    });

    return () => {
      removeUpdateListener();
    };
  }, [filePath, fileName, editor]);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="fixed-tab-header-container">
      {providers.map((provider) => {
        const Component = provider.component;
        return (
          <Component
            key={provider.id}
            filePath={filePath}
            fileName={fileName}
            editor={editor}
          />
        );
      })}
    </div>
  );
}
