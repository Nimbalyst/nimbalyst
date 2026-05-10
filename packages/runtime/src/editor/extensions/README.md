# Lexical Extension Adapter (Phase 5 scaffolding)

This directory holds the bridge between Nimbalyst's `PluginPackage` model
(`src/editor/types/PluginTypes.ts`, `src/editor/plugins/PluginRegistry.ts`)
and upstream Lexical's extension system (`@lexical/extension`,
`LexicalExtensionComposer`).

It is intentionally **scaffolding**, not a migration. Today the editor still
mounts plugins via `LexicalComposer` in `Editor.tsx` / `NimbalystEditor.tsx`;
this adapter only formalizes how the headless parts of a `PluginPackage`
correspond to a `LexicalExtension` so that an incremental migration becomes a
mechanical swap of consumers later.

## What the adapter does

`pluginPackageToExtension(pkg, options?)` returns a `LexicalExtension` whose:

- `name` matches `pkg.name`
- `nodes` matches `pkg.nodes`
- `dependencies` are resolved from `pkg.dependencies` (string names) through a
  caller-supplied `resolveDependency(name)` resolver
- `config` is a `NimbalystExtensionConfig` containing:
  - `markdownTransformers` (the package's transformers)
  - `commands` (frozen copy of `pkg.commands`)
  - `userCommands` (component-picker entries)
  - `getDynamicOptions` (component-picker dynamic options provider)
  - `pluginConfig` (opaque pass-through of `pkg.config`)
- `register?` is a thin wrapper around a caller-supplied
  `register(editor, config)` hook, or `undefined` if the caller doesn't
  supply one.

## What the adapter explicitly does NOT do (yet)

- **It does not migrate React `Component` mounting.** Plugin React components
  continue to mount inside `LexicalComposer`. Until we move the editor shell
  to `LexicalExtensionComposer`, those components remain Nimbalyst-side
  concerns.
- **It does not auto-synthesize a `register()` body.** Most current
  `PluginPackage` runtime behavior lives inside React components (effects
  registering commands, listeners, etc.). The adapter cannot infer that and
  intentionally does not try.
- **It does not mutate `PluginRegistry`.** Callers can map registered
  packages through the adapter when they want extension-shaped metadata; the
  registry remains authoritative for the existing PluginPackage shape.
- **It does not change how plugins are loaded.** No runtime difference for
  any caller until consumers explicitly opt in.

## Pilot migration candidates

Per the plan (`nimbalyst-local/plans/lexical-upgrade-and-defork.md` Phase 5),
low-risk candidates for actual migration after this scaffolding lands:

- list / checklist (`@lexical/react/LexicalListPlugin` →
  upstream `ListExtension` / `CheckListExtension`)
- history / shared-history (`@lexical/react/LexicalHistoryPlugin` →
  `HistoryExtension` / `SharedHistoryExtension`)
- horizontal rule (currently a custom `HR_TRANSFORMER` + plugin →
  `HorizontalRuleExtension`, but mind the custom transformer)
- tab indentation (`TabIndentationExtension`)

`AutoLink` is **not** a low-risk candidate: our fork has a
base64/data-URL filter that upstream's `AutoLinkExtension` does not include.

Each migration requires:

1. Replacing the React plugin component with an extension instance.
2. Wiring the extension into either an `LexicalExtensionComposer` boundary
   or a small bridge that runs `extension.register(editor, ...)` against the
   existing `LexicalComposer` editor.
3. Confirming all transformers and command flows still work.

These are out of scope for this phase.
