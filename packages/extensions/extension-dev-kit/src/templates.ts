/**
 * Extension project templates
 *
 * Each template returns a map of file paths to file contents.
 */

interface TemplateOptions {
  name: string;
  extensionId: string;
  filePatterns: string[];
}

type TemplateFiles = Record<string, string>;

const SDK_VERSION = '^0.1.0';

/**
 * Minimal extension template
 * Simple custom editor with basic functionality
 */
export function minimalTemplate(options: TemplateOptions): TemplateFiles {
  const { name, extensionId, filePatterns } = options;
  const componentName = name.replace(/[^a-zA-Z0-9]/g, '') + 'Editor';

  return {
    'manifest.json': JSON.stringify(
      {
        id: extensionId,
        name,
        version: '1.0.0',
        description: `Custom editor for ${filePatterns.join(', ')} files`,
        main: 'dist/index.js',
        apiVersion: '1.0.0',
        contributions: {
          customEditors: [
            {
              filePatterns,
              displayName: name,
              component: componentName,
            },
          ],
        },
      },
      null,
      2
    ),

    'package.json': JSON.stringify(
      {
        name: extensionId.replace(/\./g, '-'),
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          build: 'vite build',
        },
        dependencies: {
          react: '^18.2.0',
        },
        devDependencies: {
          '@nimbalyst/extension-sdk': SDK_VERSION,
          '@types/react': '^18.2.0',
          typescript: '^5.0.0',
          vite: '^7.1.12',
        },
      },
      null,
      2
    ),

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),

    'vite.config.ts': `import { defineConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default defineConfig(createExtensionConfig({
  entry: './src/index.ts',
}));
`,

    'src/index.ts': `import { ${componentName} } from './${componentName}';

export const components = {
  ${componentName},
};

export function activate() {
  console.log('${name} extension activated');
}

export function deactivate() {
  console.log('${name} extension deactivated');
}
`,

    [`src/${componentName}.tsx`]: `import React, { useState, useEffect } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

export function ${componentName}({ host }: EditorHostProps) {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    host.loadContent().then((content) => {
      if (!mounted) return;
      setText(content);
      setIsLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setText('');
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [host]);

  useEffect(() => {
    return host.onSaveRequested(async () => {
      await host.saveContent(text);
      host.setDirty(false);
    });
  }, [host, text]);

  useEffect(() => {
    return host.onFileChanged((newContent) => {
      setText(newContent);
      host.setDirty(false);
    });
  }, [host]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    host.setDirty(true);
  };

  if (isLoading) {
    return <div style={{ padding: '16px' }}>Loading...</div>;
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '16px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        marginBottom: '12px',
        color: 'var(--nim-text-muted)',
        fontSize: '12px',
      }}>
        Editing: {host.filePath}
      </div>
      <textarea
        value={text}
        onChange={handleChange}
        placeholder="Start typing..."
        style={{
          flex: 1,
          width: '100%',
          padding: '12px',
          fontSize: '14px',
          fontFamily: 'monospace',
          backgroundColor: 'var(--nim-bg-secondary)',
          color: 'var(--nim-text)',
          border: '1px solid var(--nim-border)',
          borderRadius: '4px',
          resize: 'none',
          outline: 'none',
        }}
      />
    </div>
  );
}
`,
  };
}

/**
 * Custom editor template
 * Full-featured editor with toolbar and AI tools
 */
export function customEditorTemplate(options: TemplateOptions): TemplateFiles {
  const { name, extensionId, filePatterns } = options;
  const componentName = name.replace(/[^a-zA-Z0-9]/g, '') + 'Editor';
  const toolPrefix = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  return {
    'manifest.json': JSON.stringify(
      {
        id: extensionId,
        name,
        version: '1.0.0',
        description: `Custom editor for ${filePatterns.join(', ')} files`,
        main: 'dist/index.js',
        styles: 'dist/index.css',
        apiVersion: '1.0.0',
        permissions: {
          filesystem: true,
          ai: true,
        },
        contributions: {
          customEditors: [
            {
              filePatterns,
              displayName: name,
              component: componentName,
            },
          ],
          aiTools: [`${toolPrefix}.get_info`, `${toolPrefix}.update`],
        },
      },
      null,
      2
    ),

    'package.json': JSON.stringify(
      {
        name: extensionId.replace(/\./g, '-'),
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          build: 'vite build',
        },
        dependencies: {
          react: '^18.2.0',
        },
        devDependencies: {
          '@nimbalyst/extension-sdk': SDK_VERSION,
          '@types/react': '^18.2.0',
          typescript: '^5.0.0',
          vite: '^7.1.12',
        },
      },
      null,
      2
    ),

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),

    'vite.config.ts': `import { defineConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default defineConfig(createExtensionConfig({
  entry: './src/index.ts',
}));
`,

    'src/index.ts': `import { ${componentName} } from './${componentName}';
import { aiTools } from './aiTools';
import './styles.css';

export const components = {
  ${componentName},
};

export { aiTools };

export function activate() {
  console.log('${name} extension activated');
}

export function deactivate() {
  console.log('${name} extension deactivated');
}
`,

    [`src/${componentName}.tsx`]: `import React, { useState, useEffect } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

export function ${componentName}({ host }: EditorHostProps) {
  const [data, setData] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    host.loadContent().then((content) => {
      if (!mounted) return;
      setData(content);
      setIsLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setData('');
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [host]);

  useEffect(() => {
    return host.onSaveRequested(async () => {
      await host.saveContent(data);
      host.setDirty(false);
    });
  }, [host, data]);

  useEffect(() => {
    return host.onFileChanged((newContent) => {
      setData(newContent);
      host.setDirty(false);
    });
  }, [host]);

  const handleChange = (newData: string) => {
    setData(newData);
    host.setDirty(true);
  };

  if (isLoading) {
    return <div className="${toolPrefix}-editor">Loading...</div>;
  }

  return (
    <div className="${toolPrefix}-editor">
      <div className="${toolPrefix}-editor-toolbar">
        <span className="${toolPrefix}-editor-title">${name}</span>
        <div className="${toolPrefix}-editor-actions">
          <button onClick={() => console.log('Action 1')}>Action 1</button>
          <button onClick={() => console.log('Action 2')}>Action 2</button>
        </div>
      </div>
      <div className="${toolPrefix}-editor-content">
        <textarea
          value={data}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Start editing..."
        />
      </div>
    </div>
  );
}
`,

    'src/aiTools.ts': `import type {
  AIToolContext,
  ExtensionAITool,
  ExtensionToolResult,
} from '@nimbalyst/extension-sdk';

async function loadActiveFile(context: AIToolContext): Promise<{
  filePath: string;
  content: string;
} | ExtensionToolResult> {
  if (!context.activeFilePath) {
    return { success: false, error: 'No active file is open.' };
  }

  try {
    const content = await context.extensionContext.services.filesystem.readFile(context.activeFilePath);
    return {
      filePath: context.activeFilePath,
      content,
    };
  } catch (error) {
    return {
      success: false,
      error: \`Failed to read active file: \${error instanceof Error ? error.message : String(error)}\`,
    };
  }
}

export const aiTools: ExtensionAITool[] = [
  {
    name: '${toolPrefix}.get_info',
    description: 'Get information about the current file',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context): Promise<ExtensionToolResult> => {
      const loaded = await loadActiveFile(context);
      if ('success' in loaded) {
        return loaded;
      }

      return {
        success: true,
        message: 'Retrieved file information.',
        data: {
          filePath: loaded.filePath,
          contentLength: loaded.content.length,
          lineCount: loaded.content.split('\\n').length,
        },
      };
    },
  },

  {
    name: '${toolPrefix}.update',
    description: 'Update the file content',
    inputSchema: {
      type: 'object',
      properties: {
        newContent: {
          type: 'string',
          description: 'The new content to set',
        },
      },
      required: ['newContent'],
    },
    handler: async (args, context): Promise<ExtensionToolResult> => {
      if (!context.activeFilePath) {
        return { success: false, error: 'No active file is open.' };
      }

      const newContent = typeof args.newContent === 'string' ? args.newContent : '';
      await context.extensionContext.services.filesystem.writeFile(
        context.activeFilePath,
        newContent
      );

      return {
        success: true,
        message: \`Updated \${context.activeFilePath}.\`,
      };
    },
  },
];
`,

    'src/styles.css': `.${toolPrefix}-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--nim-bg);
  color: var(--nim-text);
}

.${toolPrefix}-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--nim-bg-secondary);
  border-bottom: 1px solid var(--nim-border);
}

.${toolPrefix}-editor-title {
  font-weight: 500;
  font-size: 13px;
}

.${toolPrefix}-editor-actions {
  display: flex;
  gap: 8px;
}

.${toolPrefix}-editor-actions button {
  padding: 4px 12px;
  font-size: 12px;
  background: var(--nim-bg-tertiary);
  border: 1px solid var(--nim-border);
  border-radius: 4px;
  color: var(--nim-text);
  cursor: pointer;
}

.${toolPrefix}-editor-actions button:hover {
  background: var(--nim-bg-hover);
}

.${toolPrefix}-editor-content {
  flex: 1;
  padding: 12px;
  overflow: auto;
}

.${toolPrefix}-editor-content textarea {
  width: 100%;
  height: 100%;
  padding: 12px;
  font-family: monospace;
  font-size: 14px;
  background: var(--nim-bg-secondary);
  color: var(--nim-text);
  border: 1px solid var(--nim-border);
  border-radius: 4px;
  resize: none;
  outline: none;
}
`,
  };
}

/**
 * AI tool template
 * Extension that only provides AI tools (no UI)
 */
export function aiToolTemplate(options: TemplateOptions): TemplateFiles {
  const { name, extensionId } = options;
  const toolPrefix = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  return {
    'manifest.json': JSON.stringify(
      {
        id: extensionId,
        name,
        version: '1.0.0',
        description: `AI tools for ${name.toLowerCase()}`,
        main: 'dist/index.js',
        apiVersion: '1.0.0',
        permissions: {
          ai: true,
        },
        contributions: {
          aiTools: [`${toolPrefix}.analyze`, `${toolPrefix}.transform`],
        },
      },
      null,
      2
    ),

    'package.json': JSON.stringify(
      {
        name: extensionId.replace(/\./g, '-'),
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          build: 'vite build',
        },
        devDependencies: {
          '@nimbalyst/extension-sdk': SDK_VERSION,
          typescript: '^5.0.0',
          vite: '^7.1.12',
        },
      },
      null,
      2
    ),

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
          outDir: 'dist',
          rootDir: 'src',
        },
        include: ['src/**/*'],
      },
      null,
      2
    ),

    'vite.config.ts': `import { defineConfig } from 'vite';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default defineConfig(createExtensionConfig({
  entry: './src/index.ts',
}));
`,

    'src/index.ts': `import type {
  AIToolContext,
  ExtensionAITool,
  ExtensionToolResult,
} from '@nimbalyst/extension-sdk';

async function loadActiveFile(context: AIToolContext): Promise<{
  filePath: string;
  content: string;
} | ExtensionToolResult> {
  if (!context.activeFilePath) {
    return { success: false, error: 'No active file is open.' };
  }

  try {
    const content = await context.extensionContext.services.filesystem.readFile(context.activeFilePath);
    return {
      filePath: context.activeFilePath,
      content,
    };
  } catch (error) {
    return {
      success: false,
      error: \`Failed to read active file: \${error instanceof Error ? error.message : String(error)}\`,
    };
  }
}

// No UI components
export const components = {};

// AI tools
export const aiTools: ExtensionAITool[] = [
  {
    name: '${toolPrefix}.analyze',
    description: 'Analyze the current document',
    scope: 'global',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context): Promise<ExtensionToolResult> => {
      const loaded = await loadActiveFile(context);
      if ('success' in loaded) {
        return loaded;
      }

      const content = loaded.content;
      const lines = content.split('\\n');
      const words = content.split(/\\s+/).filter(w => w.length > 0);

      return {
        success: true,
        message: 'Analyzed the active document.',
        data: {
          filePath: loaded.filePath,
          stats: {
            characters: content.length,
            lines: lines.length,
            words: words.length,
          },
        },
      };
    },
  },

  {
    name: '${toolPrefix}.transform',
    description: 'Transform the document content',
    scope: 'global',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['uppercase', 'lowercase', 'reverse'],
          description: 'The transformation to apply',
        },
      },
      required: ['operation'],
    },
    handler: async (args, context): Promise<ExtensionToolResult> => {
      const loaded = await loadActiveFile(context);
      if ('success' in loaded) {
        return loaded;
      }

      const operation = args.operation as string;
      let result: string;

      switch (operation) {
        case 'uppercase':
          result = loaded.content.toUpperCase();
          break;
        case 'lowercase':
          result = loaded.content.toLowerCase();
          break;
        case 'reverse':
          result = loaded.content.split('').reverse().join('');
          break;
        default:
          return { success: false, error: \`Unknown operation: \${operation}\` };
      }

      await context.extensionContext.services.filesystem.writeFile(
        loaded.filePath,
        result
      );

      return {
        success: true,
        message: \`Applied \${operation} to \${loaded.filePath}.\`,
      };
    },
  },
];

export function activate() {
  console.log('${name} extension activated');
}

export function deactivate() {
  console.log('${name} extension deactivated');
}
`,
  };
}

// Export all templates
export const templates = {
  minimal: minimalTemplate,
  'custom-editor': customEditorTemplate,
  'ai-tool': aiToolTemplate,
};
