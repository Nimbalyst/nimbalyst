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
          '@nimbalyst/extension-sdk': '*',
          '@types/react': '^18.2.0',
          typescript: '^5.0.0',
          vite: '^5.0.0',
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

interface ${componentName}Props {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

export function ${componentName}({ content, filePath, onChange }: ${componentName}Props) {
  const [text, setText] = useState(content);

  useEffect(() => {
    setText(content);
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    onChange(newText);
  };

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
        Editing: {filePath}
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
        styles: 'dist/styles.css',
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
          '@nimbalyst/extension-sdk': '*',
          '@types/react': '^18.2.0',
          typescript: '^5.0.0',
          vite: '^5.0.0',
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

interface ${componentName}Props {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

export function ${componentName}({ content, filePath, onChange }: ${componentName}Props) {
  const [data, setData] = useState(content);

  useEffect(() => {
    setData(content);
  }, [content]);

  const handleChange = (newData: string) => {
    setData(newData);
    onChange(newData);
  };

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

    'src/aiTools.ts': `import type { ExtensionAITool } from '@nimbalyst/extension-sdk';

export const aiTools: ExtensionAITool[] = [
  {
    name: '${toolPrefix}.get_info',
    description: 'Get information about the current file',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      return {
        filePath: context.filePath,
        contentLength: context.fileContent.length,
        lineCount: context.fileContent.split('\\n').length,
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
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      return {
        success: true,
        newContent: args.newContent as string,
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
          '@nimbalyst/extension-sdk': '*',
          typescript: '^5.0.0',
          vite: '^5.0.0',
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

    'src/index.ts': `import type { ExtensionAITool } from '@nimbalyst/extension-sdk';

// No UI components
export const components = {};

// AI tools
export const aiTools: ExtensionAITool[] = [
  {
    name: '${toolPrefix}.analyze',
    description: 'Analyze the current document',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (_args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const content = context.fileContent;
      const lines = content.split('\\n');
      const words = content.split(/\\s+/).filter(w => w.length > 0);

      return {
        filePath: context.filePath,
        stats: {
          characters: content.length,
          lines: lines.length,
          words: words.length,
        },
      };
    },
  },

  {
    name: '${toolPrefix}.transform',
    description: 'Transform the document content',
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
    handler: async (args, context) => {
      if (!context.fileContent) {
        return { error: 'No file is currently open' };
      }

      const operation = args.operation as string;
      let result: string;

      switch (operation) {
        case 'uppercase':
          result = context.fileContent.toUpperCase();
          break;
        case 'lowercase':
          result = context.fileContent.toLowerCase();
          break;
        case 'reverse':
          result = context.fileContent.split('').reverse().join('');
          break;
        default:
          return { error: \`Unknown operation: \${operation}\` };
      }

      return {
        success: true,
        newContent: result,
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
