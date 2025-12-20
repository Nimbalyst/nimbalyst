---
planStatus:
  planId: plan-extension-build-time-transformation
  title: Build-Time External Transformation for Extensions
  status: in-review
  planType: system-design
  priority: high
  owner: claude
  stakeholders:
    - ghinkle
  tags:
    - extensions
    - build-system
    - architecture
  created: "2025-12-19"
  updated: "2025-12-19T23:30:00.000Z"
  progress: 80
---
# Build-Time External Transformation for Extensions

## Problem Statement

Extensions are loaded via blob URLs because they're read from disk and executed dynamically. Blob URLs cannot resolve bare module specifiers like `import React from 'react'` - the browser has no idea where "react" lives.

The previous solution was **runtime regex transformation**: after reading the extension's bundled JS, we'd use regex to transform `import X from 'react'` into `const X = window.__nimbalyst_extensions.react`.

This kept breaking because:
1. Minifiers produce unpredictable variable names (`$t`, `_r`, etc.)
2. The regex patterns used `\w+` which doesn't match `$`
3. Every new minifier quirk required a new regex fix
4. Untestable - you can't enumerate all possible minified outputs

## Proposed Solution: Build-Time Transformation

Instead of transforming at runtime (after minification), transform at build time (before minification).

A Vite plugin intercepts imports to shared dependencies and resolves them to virtual modules that access `window.__nimbalyst_extensions`. The transformation happens on predictable source code, and the resulting `window.__nimbalyst_extensions["react"]` string survives minification unchanged.

## Why This Design?

### Alternative 1: Import Maps

Import maps let browsers resolve bare specifiers natively:
```html
<script type="importmap">
{ "imports": { "react": "/path/to/react.js" } }
</script>
```

**Why not**: Import maps must be set up before ANY modules load. In Electron, React and the app bundle load immediately. We'd need to restructure the entire app initialization to inject the import map first, then load everything else. Major architectural change for a narrow problem.

### Alternative 2: SystemJS or Custom Module Loader

Replace the browser's native module system with a custom loader that handles bare specifiers.

**Why not**: Adds significant runtime complexity and another dependency. The native ES module system works fine - we just need to not emit bare specifiers in the first place.

### Alternative 3: Service Worker Interception

Intercept fetch requests for module URLs and redirect to host dependencies.

**Why not**: Service workers have lifecycle complexity, don't work in all contexts, and add latency. Overkill for this problem.

### Alternative 4: Build-Time Transformation (chosen)

Transform imports during the extension build so the output already uses `window.__nimbalyst_extensions`.

**Why this works**:
- Source code has predictable import syntax
- Transformation happens once at build time, not on every load
- Build errors surface immediately if something is wrong
- The runtime loader becomes trivial (just load and execute)
- Backwards compatible - runtime fallback still works for old extensions

## Trade-offs

### Downsides

1. **Hardcoded export lists**: The plugin needs to know which exports each external module provides. If an extension uses an export we didn't list, the build fails. However, this surfaces the error at build time rather than runtime, which is better.

2. **SDK coupling**: Extensions must use the SDK's build config (or manually add the plugin). Extensions with custom configs need updating.

3. **Two transformation systems**: We keep the runtime regex as a fallback, so there's duplicate logic. But it's isolated and documented.

### Upsides

1. **Robust**: String literals in code (`window.__nimbalyst_extensions["react"]`) survive any minification.

2. **Debuggable**: Build failures point to the exact import that's missing, not a cryptic runtime error.

3. **Predictable**: Same input always produces same output. No runtime variance.

4. **Fast**: No regex transformation on every extension load.

## Implementation

1. `nimbalystExternalsPlugin` in `packages/extension-sdk/src/externalsPlugin.ts`
  - Intercepts imports via `resolveId` hook
  - Returns virtual module code via `load` hook
  - Virtual module accesses `window.__nimbalyst_extensions`

2. `createExtensionConfig` in `packages/extension-sdk/src/vite.ts`
  - Includes the plugin by default
  - Removes Rollup `external` config (no longer needed)

3. Runtime fallback in `ExtensionPlatformServiceImpl.ts`
  - Kept for backwards compatibility
  - Fixed `[\w$]+` pattern for minified names
  - Documented as fallback only

## Open Questions

1. Should we eventually remove the runtime fallback? It's technical debt but provides safety net.

2. Should we auto-generate the export lists from the actual packages? Would eliminate manual maintenance but adds build complexity.

3. Is there a way to make the plugin more dynamic (handle any export) without breaking tree-shaking?

## Decision Needed

Is this the right architectural direction, or should we invest in one of the alternatives (particularly import maps, which is the "correct" web platform solution)?
