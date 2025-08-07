# Stravu Editor Plugin Architecture

## Overview

The new plugin architecture solves the encapsulation problem by bundling plugins with their dependencies (nodes, transformers, commands) into self-contained packages.

## Key Components

### 1. PluginPackage Interface
```typescript
interface PluginPackage<T = any> {
  name: string;                    // Unique identifier
  Component: ComponentType<T>;     // React component
  nodes?: Klass<LexicalNode>[];  // Lexical nodes
  transformers?: Transformer[];    // Markdown transformers
  commands?: Record<string, LexicalCommand<any>>; // Exported commands
  config?: T;                      // Default configuration
  dependencies?: string[];         // Other required plugins
  enabledByDefault?: boolean;
}
```

### 2. Plugin Registry
- Central registry for all plugins
- Manages dependencies between plugins
- Collects nodes and transformers from enabled plugins
- Allows runtime enable/disable of plugins

### 3. Benefits

**Better Encapsulation**
- Each plugin is self-contained with its nodes and transformers
- No need to maintain separate lists in EditorNodes.ts and MarkdownTransformers/index.ts
- Clear ownership of nodes and transformers

**Easy Extension**
- Library users can create custom plugins without modifying core code
- Plugins can be distributed as npm packages
- Simple API for registering new plugins

**Dynamic Configuration**
- Enable/disable plugins at runtime
- Override plugin configurations
- Dependency management ensures consistency

**Cleaner Code Organization**
- Plugin folders contain all related code
- No more centralized nodes folder
- Each plugin manages its own imports/exports

## Usage Examples

### Creating a Custom Plugin
```typescript
const MyCustomPlugin: PluginPackage = {
  name: 'my-custom-plugin',
  Component: MyPluginComponent,
  nodes: [MyCustomNode],
  transformers: [MY_CUSTOM_TRANSFORMER],
  commands: { INSERT_CUSTOM: INSERT_CUSTOM_COMMAND },
};
```

### Using in Editor
```typescript
<App 
  customPlugins={[MyCustomPlugin]}
  editorConfig={{
    enabledPlugins: ['my-custom-plugin'],
    pluginConfigs: {
      'my-custom-plugin': { someOption: true }
    }
  }}
/>
```

## Migration Path

1. Move node files to their respective plugin folders
2. Create package.ts file for each plugin
3. Register plugins in registerBuiltinPlugins.ts
4. Update imports in Editor component
5. Remove centralized EditorNodes.ts

This architecture provides the encapsulation you were looking for while maintaining compatibility with Lexical's design patterns!