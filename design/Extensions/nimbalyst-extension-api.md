# Nimbalyst Extension API Design

This document provides the detailed TypeScript API definitions for the Nimbalyst Extension System.

## Core Extension Interface

```typescript
// Top-level extension interface
interface NimbalystExtension {
  /** Extension metadata */
  id: string;  // Unique ID (e.g., 'com.example.my-extension')
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;

  /** Permissions required */
  permissions?: {
    database?: boolean;          // Access to database
    filesystem?: boolean;         // File system access
    network?: boolean;            // Network requests
    ipc?: boolean;                // IPC communication
    shell?: boolean;              // Shell command execution
  };

  /** Application-level hooks */
  activate?: (context: ExtensionContext) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;

  /** Menu contributions */
  menus?: MenuContribution[];

  /** Command contributions */
  commands?: CommandContribution[];

  /** UI contributions */
  panels?: PanelContribution[];
  dialogs?: DialogContribution[];
  statusBarItems?: StatusBarItemContribution[];

  /** Database contributions */
  database?: {
    migrations?: Migration[];
    queries?: Record<string, string>;  // Named queries
  };

  /** Settings contributions */
  settings?: SettingsContribution[];

  /** Custom editor contributions */
  customEditors?: CustomEditorContribution[];

  /** AI contributions */
  ai?: {
    /** Tools exposed to AI agents */
    tools?: AIToolContribution[];
    /** Context layered into AI prompts */
    contextProvider?: (context: ExtensionContext) => Promise<string | AIContextLayer>;
    /** Instructions for AI when extension is active */
    instructions?: string;
  };

  /** Editor contributions (wraps Lexical) */
  editor?: EditorExtension;
}
```

## Extension Context

```typescript
// Extension context provided to extensions
interface ExtensionContext {
  /** Extension metadata */
  extensionId: string;
  extensionPath: string;
  storageUri: string;  // Private storage for this extension

  /** Application APIs */
  app: {
    registerCommand(id: string, handler: CommandHandler): Disposable;
    registerMenu(menu: MenuContribution): Disposable;
    showDialog(options: DialogOptions): Promise<any>;
    getWorkspacePath(): string | undefined;
    onDidChangeWorkspace(handler: (path: string) => void): Disposable;
  };

  /** Database API */
  database?: {
    query<T>(sql: string, params?: any[]): Promise<T[]>;
    execute(sql: string, params?: any[]): Promise<void>;
    transaction<T>(callback: () => Promise<T>): Promise<T>;
  };

  /** UI APIs */
  ui: {
    showPanel(panel: PanelOptions): Disposable;
    showNotification(message: string, type?: 'info' | 'warning' | 'error'): void;
    showStatusBarItem(item: StatusBarItem): Disposable;
  };

  /** Settings API */
  settings: {
    get<T>(key: string, defaultValue?: T): T;
    set(key: string, value: any): Promise<void>;
    onChange(key: string, handler: (value: any) => void): Disposable;
  };

  /** File system API */
  fs?: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    watchFile(path: string, handler: (event: FileChangeEvent) => void): Disposable;
  };

  /** Editor API */
  editor: {
    getActiveEditor(): LexicalEditor | undefined;
    onDidChangeActiveEditor(handler: (editor: LexicalEditor | undefined) => void): Disposable;
  };
}
```

## Menu and Command Contributions

```typescript
// Menu contribution
interface MenuContribution {
  menu: 'file' | 'edit' | 'view' | 'help' | 'context';
  group?: string;
  items: MenuItem[];
}

interface MenuItem {
  id: string;
  label: string;
  command: string;  // Command ID to execute
  accelerator?: string;  // Keyboard shortcut
  icon?: string;
  when?: string;  // Condition expression
}

// Command contribution
interface CommandContribution {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  handler: CommandHandler;
  when?: string;  // Condition expression
}

type CommandHandler = (args?: any) => Promise<any> | any;
```

## UI Contributions

```typescript
// Panel contribution
interface PanelContribution {
  id: string;
  title: string;
  icon?: string;
  location: 'sidebar' | 'bottom' | 'modal';
  component: React.ComponentType<PanelProps>;
}

interface PanelProps {
  context: ExtensionContext;
}
```

## Custom Editor System

```typescript
// Custom editor contribution
interface CustomEditorContribution {
  /** File patterns this editor handles (e.g., '*.wireframe.html') */
  filePatterns: string[];

  /** Display name for this editor type */
  displayName: string;

  /** Icon for this editor type */
  icon?: string;

  /** Priority when multiple editors can handle the same file type */
  priority?: number;

  /** React component that renders the editor */
  component: React.ComponentType<CustomEditorProps>;

  /** Custom toolbar component (optional) */
  toolbarComponent?: React.ComponentType<CustomEditorToolbarProps>;

  /** Custom save handler (optional, if not using default text save) */
  saveHandler?: (filePath: string, content: any) => Promise<void>;

  /** Custom load handler (optional, if not using default text load) */
  loadHandler?: (filePath: string) => Promise<any>;
}

interface CustomEditorProps {
  /** Path to the file being edited */
  filePath: string;

  /** Initial content */
  initialContent: any;

  /** Callback when content changes */
  onChange: (content: any, isDirty: boolean) => void;

  /** Extension context */
  context: ExtensionContext;
}

interface CustomEditorToolbarProps {
  /** Current file path */
  filePath: string;

  /** Current content */
  content: any;

  /** Extension context */
  context: ExtensionContext;
}
```

## AI Integration

```typescript
// AI tool contribution
interface AIToolContribution {
  /** Tool name as exposed to AI (e.g., 'create_wireframe') */
  name: string;

  /** Tool description for AI to understand when to use it */
  description: string;

  /** JSON schema for tool parameters */
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };

  /** Handler that executes when AI invokes this tool */
  handler: (params: any, context: AIToolContext) => Promise<AIToolResult>;
}

interface AIToolContext extends ExtensionContext {
  /** Current AI session information */
  session: {
    id: string;
    provider: string;
  };

  /** Current workspace and file context */
  workspace?: {
    path: string;
    currentFile?: string;
  };
}

interface AIToolResult {
  /** Success indicator */
  success: boolean;

  /** Result data to send back to AI */
  data?: any;

  /** Error message if failed */
  error?: string;

  /** Optional attachments to add to conversation (screenshots, exports, etc.) */
  attachments?: AIAttachment[];
}

interface AIAttachment {
  /** Type of attachment */
  type: 'image' | 'file' | 'text';

  /** File path or data URL */
  data: string;

  /** Display name */
  name?: string;

  /** MIME type */
  mimeType?: string;
}

// AI context layer
interface AIContextLayer {
  /** Layer priority (higher = added later in prompt) */
  priority: number;

  /** Context content to inject */
  content: string;

  /** Optional: only include for specific providers */
  providers?: string[];
}
```

## Editor Extensions (Lexical Wrapper)

```typescript
// Editor extension (wraps Lexical)
interface EditorExtension {
  /** Lexical nodes to register */
  nodes?: Array<Klass<LexicalNode>>;

  /** Markdown transformers */
  transformers?: Transformer[];

  /** Component Picker commands */
  componentCommands?: ComponentCommand[];

  /** Lexical extension configuration */
  lexical?: {
    config?: (context: LexicalExtensionContext) => Partial<InitialEditorConfig>;
    init?: (context: LexicalExtensionContext) => void;
    build?: (context: LexicalExtensionContext) => ExtensionOutput;
    register?: (editor: LexicalEditor) => () => void;
    afterRegistration?: (editor: LexicalEditor) => void;
    dependencies?: Extension[];
    peerDependencies?: Extension[];
    conflictsWith?: Extension[];
  };
}

interface ComponentCommand {
  title: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  command: LexicalCommand<any>;
  payload?: any;
}
```

## Extension System Manager

```typescript
// Extension manager
class NimbalystExtensionSystem {
  private extensions = new Map<string, NimbalystExtension>();
  private contexts = new Map<string, ExtensionContext>();

  async register(ext: NimbalystExtension): Promise<void> {
    // Validate extension
    this.validateExtension(ext);

    // Create context
    const context = this.createContext(ext);
    this.contexts.set(ext.id, context);

    // Store extension
    this.extensions.set(ext.id, ext);

    // Activate extension
    if (ext.activate) {
      await ext.activate(context);
    }

    // Register contributions
    this.registerMenus(ext, context);
    this.registerCommands(ext, context);
    this.registerPanels(ext, context);
    this.runDatabaseMigrations(ext, context);
  }

  async unregister(extensionId: string): Promise<void> {
    const ext = this.extensions.get(extensionId);
    if (!ext) return;

    // Deactivate
    if (ext.deactivate) {
      await ext.deactivate();
    }

    // Cleanup
    this.extensions.delete(extensionId);
    this.contexts.delete(extensionId);
  }

  // Get editor extensions for Lexical
  getEditorExtensions(): Extension[] {
    return Array.from(this.extensions.values())
      .filter(e => e.editor?.lexical)
      .map(e => this.wrapLexicalExtension(e));
  }

  // Get markdown transformers
  getTransformers(): Transformer[] {
    return Array.from(this.extensions.values())
      .filter(e => e.editor?.transformers)
      .flatMap(e => e.editor!.transformers!);
  }

  // Get component commands for Component Picker
  getComponentCommands(): ComponentCommand[] {
    return Array.from(this.extensions.values())
      .filter(e => e.editor?.componentCommands)
      .flatMap(e => e.editor!.componentCommands!);
  }

  // Get custom editor registrations
  getCustomEditors(): CustomEditorContribution[] {
    return Array.from(this.extensions.values())
      .filter(e => e.customEditors)
      .flatMap(e => e.customEditors!);
  }

  // Find custom editor for a file path
  findCustomEditorForFile(filePath: string): CustomEditorContribution | undefined {
    const editors = this.getCustomEditors();
    return editors
      .filter(e => this.matchesPattern(filePath, e.filePatterns))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  }

  // Get AI tools from all extensions
  getAITools(): Map<string, AIToolContribution> {
    const tools = new Map<string, AIToolContribution>();
    for (const ext of this.extensions.values()) {
      if (ext.ai?.tools) {
        for (const tool of ext.ai.tools) {
          tools.set(tool.name, tool);
        }
      }
    }
    return tools;
  }

  // Get AI context layers from all active extensions
  async getAIContextLayers(context: { provider?: string }): Promise<string[]> {
    const layers: AIContextLayer[] = [];

    for (const ext of this.extensions.values()) {
      if (ext.ai?.instructions) {
        layers.push({
          priority: 0,
          content: ext.ai.instructions,
        });
      }

      if (ext.ai?.contextProvider) {
        const extContext = this.contexts.get(ext.id);
        if (extContext) {
          const result = await ext.ai.contextProvider(extContext);
          if (typeof result === 'string') {
            layers.push({ priority: 50, content: result });
          } else {
            if (!result.providers || result.providers.includes(context.provider || '')) {
              layers.push(result);
            }
          }
        }
      }
    }

    return layers
      .sort((a, b) => a.priority - b.priority)
      .map(l => l.content);
  }

  // Invoke an AI tool
  async invokeAITool(
    toolName: string,
    params: any,
    aiContext: AIToolContext
  ): Promise<AIToolResult> {
    const tool = this.getAITools().get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found`,
      };
    }

    try {
      return await tool.handler(params, aiContext);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createContext(ext: NimbalystExtension): ExtensionContext {
    // Create context with APIs based on permissions
    return {
      extensionId: ext.id,
      extensionPath: this.getExtensionPath(ext.id),
      storageUri: this.getStorageUri(ext.id),
      app: this.createAppAPI(ext),
      database: ext.permissions?.database ? this.createDatabaseAPI(ext) : undefined,
      ui: this.createUIAPI(ext),
      settings: this.createSettingsAPI(ext),
      fs: ext.permissions?.filesystem ? this.createFsAPI(ext) : undefined,
      editor: this.createEditorAPI(ext),
    };
  }

  // ... implementation details
}
```

## Application Initialization

```typescript
// Initialize extension system at app startup
const extensionSystem = new NimbalystExtensionSystem();

// Register built-in extensions
await extensionSystem.register(MermaidExtension);
await extensionSystem.register(TableExtension);
await extensionSystem.register(TaskManagerExtension);

// Register third-party extensions
const userExtensions = await loadUserExtensions();
for (const ext of userExtensions) {
  await extensionSystem.register(ext);
}

// Initialize editor with aggregated editor extensions
const editor = buildEditorFromExtensions(
  extensionSystem.getEditorExtensions(),
  {
    // Additional editor config
  }
);

// Or with React
<LexicalExtensionComposer extensions={extensionSystem.getEditorExtensions()}>
  <Editor transformers={extensionSystem.getTransformers()} />
</LexicalExtensionComposer>

// Component Picker uses aggregated commands
<ComponentPicker commands={extensionSystem.getComponentCommands()} />

// Route files to custom editors
const customEditor = extensionSystem.findCustomEditorForFile('design.wireframe.html');
if (customEditor) {
  <customEditor.component
    filePath={filePath}
    initialContent={content}
    onChange={handleChange}
    context={extensionContext}
  />
}

// Inject AI context layers
const aiContext = await extensionSystem.getAIContextLayers({ provider: 'claude' });
const systemPrompt = [...basePrompt, ...aiContext].join('\n\n');

// Invoke AI tools
const result = await extensionSystem.invokeAITool('create_wireframe', {
  filename: 'dashboard',
  title: 'Admin Dashboard',
}, aiToolContext);
```

## Example Extensions

### Example 1: Simple Editor Extension (Mermaid)

```typescript
export const MermaidExtension: NimbalystExtension = {
  id: 'com.nimbalyst.mermaid',
  name: 'Mermaid Diagrams',
  version: '1.0.0',
  description: 'Add Mermaid diagram support to your documents',
  author: 'Nimbalyst Team',

  // Editor-only extension, no special permissions needed
  editor: {
    nodes: [MermaidNode],
    transformers: [MERMAID_TRANSFORMER],
    componentCommands: [
      {
        title: 'Mermaid Diagram',
        description: 'Insert a Mermaid diagram for flowcharts, sequence diagrams, and more',
        icon: 'account_tree',
        keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'chart', 'graph', 'uml'],
        command: INSERT_MERMAID_COMMAND,
      },
    ],
    lexical: {
      register: (editor) => {
        return editor.registerCommand(
          INSERT_MERMAID_COMMAND,
          (payload) => {
            // Insert mermaid diagram
            return true;
          },
          COMMAND_PRIORITY_EDITOR
        );
      },
    },
  },
};
```

### Example 2: Full Application Extension (Task Manager)

```typescript
export const TaskManagerExtension: NimbalystExtension = {
  id: 'com.example.task-manager',
  name: 'Task Manager',
  version: '1.0.0',
  description: 'Manage tasks across your documents',

  permissions: {
    database: true,
    filesystem: true,
  },

  activate: async (context) => {
    // Initialize task database
    await context.database!.execute(`
      CREATE TABLE IF NOT EXISTS ext_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        completed BOOLEAN DEFAULT false,
        document_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Register command to show task panel
    context.app.registerCommand('task-manager.show', async () => {
      context.ui.showPanel({
        id: 'task-panel',
        title: 'Tasks',
        component: TaskPanelComponent,
      });
    });
  },

  menus: [
    {
      menu: 'view',
      group: 'panels',
      items: [
        {
          id: 'task-manager.show',
          label: 'Show Tasks',
          command: 'task-manager.show',
          accelerator: 'CmdOrCtrl+Shift+T',
          icon: 'check_box',
        },
      ],
    },
  ],

  commands: [
    {
      id: 'task-manager.add',
      title: 'Add Task',
      icon: 'add_task',
      keywords: ['task', 'todo', 'add'],
      handler: async (context) => {
        const title = await context.app.showDialog({
          type: 'input',
          title: 'New Task',
          placeholder: 'Enter task title...',
        });

        if (title) {
          await context.database!.execute(
            'INSERT INTO ext_tasks (id, title) VALUES (?, ?)',
            [crypto.randomUUID(), title]
          );
          context.ui.showNotification('Task added!', 'info');
        }
      },
    },
  ],

  panels: [
    {
      id: 'task-panel',
      title: 'Tasks',
      icon: 'check_box',
      location: 'sidebar',
      component: TaskPanelComponent,
    },
  ],

  settings: [
    {
      key: 'task-manager.showCompleted',
      title: 'Show Completed Tasks',
      type: 'boolean',
      default: true,
    },
  ],
};
```

### Example 3: Extension with Editor + App Features (Word Counter)

```typescript
export const WordCounterExtension: NimbalystExtension = {
  id: 'com.example.word-counter',
  name: 'Word Counter',
  version: '1.0.0',

  permissions: {
    database: true,
  },

  activate: async (context) => {
    // Track word count changes
    context.editor.onDidChangeActiveEditor((editor) => {
      if (!editor) return;

      const updateWordCount = () => {
        const text = editor.getEditorState().read(() => {
          return $getRoot().getTextContent();
        });

        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

        // Update status bar
        context.ui.showStatusBarItem({
          id: 'word-count',
          text: `${wordCount} words`,
          alignment: 'right',
        });

        // Store in database
        const docPath = context.app.getWorkspacePath();
        if (docPath) {
          context.database!.execute(
            'INSERT INTO ext_word_counts (path, count, timestamp) VALUES (?, ?, ?)',
            [docPath, wordCount, Date.now()]
          );
        }
      };

      // Update on every change
      editor.registerUpdateListener(updateWordCount);
      updateWordCount();
    });
  },

  database: {
    migrations: [
      {
        version: 1,
        up: `
          CREATE TABLE IF NOT EXISTS ext_word_counts (
            path TEXT NOT NULL,
            count INTEGER NOT NULL,
            timestamp INTEGER NOT NULL
          )
        `,
      },
    ],
  },

  statusBarItems: [
    {
      id: 'word-count',
      alignment: 'right',
      priority: 100,
    },
  ],
};
```

### Example 4: Custom Editor with AI Integration (WireframeLM)

This example demonstrates how the WireframeLM system could be implemented as an extension, showcasing:
- Custom editor registration for `.wireframe.html` files
- AI tool integration (`create_wireframe`, `export_wireframe`)
- AI context layering (listing wireframes in workspace)
- AI instructions for understanding wireframe capabilities
- Screenshot attachments sent back to AI
- Custom save/load handlers
- Menu and command contributions
- Specialized toolbar component

```typescript
export const WireframeLMExtension: NimbalystExtension = {
  id: 'com.nimbalyst.wireframelm',
  name: 'WireframeLM Designer',
  version: '1.0.0',
  description: 'Visual wireframe designer with AI integration',
  author: 'Nimbalyst Team',

  permissions: {
    filesystem: true,
  },

  // Register custom editor for .wireframe.html files
  customEditors: [
    {
      filePatterns: ['*.wireframe.html'],
      displayName: 'Wireframe Designer',
      icon: 'grid_on',
      priority: 100,
      component: WireframeLMEditor,
      toolbarComponent: WireframeLMToolbar,

      saveHandler: async (filePath, content) => {
        // Custom save logic for wireframe format
        await fs.writeFile(filePath, content.html, 'utf8');
      },

      loadHandler: async (filePath) => {
        // Custom load logic
        const html = await fs.readFile(filePath, 'utf8');
        return { html, elements: parseWireframe(html) };
      },
    },
  ],

  // AI integration
  ai: {
    // Layer instructions into AI prompts
    instructions: `
You have access to a wireframe design system. You can create interactive wireframes
for web applications using the create_wireframe tool. Wireframes are saved as
.wireframe.html files that can be edited visually.
    `.trim(),

    // Expose AI tools
    tools: [
      {
        name: 'create_wireframe',
        description: 'Create a new wireframe design file for a web application or UI mockup',
        parameters: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name for the wireframe file (will add .wireframe.html extension)',
            },
            title: {
              type: 'string',
              description: 'Title/description of what the wireframe represents',
            },
            elements: {
              type: 'array',
              description: 'Initial wireframe elements to create',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['box', 'text', 'button', 'image'] },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' },
                  label: { type: 'string' },
                },
              },
            },
          },
          required: ['filename', 'title'],
        },
        handler: async (params, context) => {
          const { filename, title, elements = [] } = params;
          const fullPath = path.join(
            context.workspace!.path,
            `${filename}.wireframe.html`
          );

          // Generate wireframe HTML
          const html = generateWireframeHTML(title, elements);

          // Save file
          await context.fs!.writeFile(fullPath, html);

          // Capture screenshot
          const screenshot = await captureWireframeScreenshot(html);

          return {
            success: true,
            data: {
              filePath: fullPath,
              elementCount: elements.length,
            },
            attachments: [
              {
                type: 'image',
                data: screenshot,
                name: `${filename}-preview.png`,
                mimeType: 'image/png',
              },
            ],
          };
        },
      },
      {
        name: 'export_wireframe',
        description: 'Export wireframe as PNG image or HTML',
        parameters: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Wireframe filename to export',
            },
            format: {
              type: 'string',
              enum: ['png', 'html'],
              description: 'Export format',
            },
          },
          required: ['filename', 'format'],
        },
        handler: async (params, context) => {
          const { filename, format } = params;
          const wireframePath = path.join(
            context.workspace!.path,
            filename.endsWith('.wireframe.html') ? filename : `${filename}.wireframe.html`
          );

          const html = await context.fs!.readFile(wireframePath);

          if (format === 'png') {
            const screenshot = await captureWireframeScreenshot(html);
            const exportPath = wireframePath.replace('.wireframe.html', '.png');
            await context.fs!.writeFile(exportPath, screenshot);

            return {
              success: true,
              data: { exportPath },
              attachments: [
                {
                  type: 'image',
                  data: screenshot,
                  name: path.basename(exportPath),
                  mimeType: 'image/png',
                },
              ],
            };
          } else {
            const exportPath = wireframePath.replace('.wireframe.html', '.html');
            await context.fs!.writeFile(exportPath, html);

            return {
              success: true,
              data: { exportPath },
            };
          }
        },
      },
    ],

    // Dynamic context provider
    contextProvider: async (context) => {
      const workspace = context.app.getWorkspacePath();
      if (!workspace) return '';

      // Find all wireframe files in workspace
      const wireframes = await findWireframeFiles(workspace);

      if (wireframes.length === 0) return '';

      return {
        priority: 75,
        content: `
This workspace contains ${wireframes.length} wireframe design(s):
${wireframes.map(w => `- ${w.name}: ${w.title}`).join('\n')}

You can reference, modify, or export these wireframes using the wireframe tools.
        `.trim(),
      };
    },
  },

  // Menu contributions
  menus: [
    {
      menu: 'file',
      group: 'new',
      items: [
        {
          id: 'wireframelm.new',
          label: 'New Wireframe',
          command: 'wireframelm.create',
          accelerator: 'CmdOrCtrl+Shift+W',
          icon: 'grid_on',
        },
      ],
    },
  ],

  // Commands
  commands: [
    {
      id: 'wireframelm.create',
      title: 'Create New Wireframe',
      icon: 'grid_on',
      keywords: ['wireframe', 'mockup', 'design', 'ui'],
      handler: async (context) => {
        const filename = await context.app.showDialog({
          type: 'input',
          title: 'New Wireframe',
          placeholder: 'Enter wireframe name...',
        });

        if (filename) {
          const workspace = context.app.getWorkspacePath();
          if (!workspace) return;

          const filePath = path.join(workspace, `${filename}.wireframe.html`);
          const html = generateWireframeHTML(filename, []);
          await context.fs!.writeFile(filePath, html);

          context.ui.showNotification('Wireframe created!', 'info');
        }
      },
    },
  ],
};
```

## Helper Types

```typescript
type Disposable = {
  dispose(): void;
};

interface FileChangeEvent {
  type: 'created' | 'modified' | 'deleted';
  path: string;
}

interface DialogOptions {
  type: 'input' | 'confirm' | 'select';
  title: string;
  placeholder?: string;
  message?: string;
  options?: string[];
}

interface PanelOptions {
  id: string;
  title: string;
  component: React.ComponentType<any>;
}

interface StatusBarItem {
  id: string;
  text: string;
  alignment: 'left' | 'right';
  priority?: number;
}

interface Migration {
  version: number;
  up: string;
  down?: string;
}

interface SettingsContribution {
  key: string;
  title: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  default: any;
  options?: any[];
}

interface StatusBarItemContribution {
  id: string;
  alignment: 'left' | 'right';
  priority?: number;
}

interface DialogContribution {
  // TBD - for custom dialog registration
}
```
