/**
 * Adapter that converts a Nimbalyst {@link PluginPackage} into a Lexical
 * {@link LexicalExtension} (`@lexical/extension` 0.44+).
 *
 * Scope of this adapter (intentionally narrow):
 *
 * - It moves the **headless** parts of a PluginPackage to upstream's extension
 *   metadata: name, nodes, dependency declarations, and a config bag for
 *   markdown transformers and Lexical commands so other extensions can read
 *   them.
 * - It does NOT migrate React `Component` mounting. Today, plugin React
 *   components are mounted inside `LexicalComposer` by `Editor.tsx`. Until we
 *   move the editor shell to `LexicalExtensionComposer`, those components
 *   remain Nimbalyst-side concerns.
 * - It does NOT change how plugins currently register at runtime. `register()`
 *   on the produced extension is a no-op unless the package supplies one
 *   explicitly via `registerWithExtension`.
 * - It does NOT mutate `PluginRegistry`. Callers that want extension-shaped
 *   metadata can map registered packages through the adapter; callers that
 *   want the existing PluginPackage shape continue using the registry.
 *
 * The adapter exists so that:
 *
 * 1. Future incremental migration to `LexicalExtensionComposer` becomes a
 *    matter of swapping consumers, not rewriting plugins.
 * 2. Built-in plugins can be expressed in upstream's extension shape
 *    alongside any Nimbalyst-specific metadata.
 *
 * See `nimbalyst-local/plans/lexical-upgrade-and-defork.md` (Phase 5) for
 * context.
 */

import type { LexicalCommand, LexicalEditor } from 'lexical';
import { defineExtension, type LexicalExtension } from '@lexical/extension';
import type { Transformer } from '@lexical/markdown';

import type {
  DynamicMenuOption,
  PluginPackage,
  UserCommand,
} from '../types/PluginTypes';

/**
 * Config exposed by an adapted extension. Other extensions or the editor
 * shell can read this to enumerate Nimbalyst-side resources contributed by
 * the plugin.
 */
export interface NimbalystExtensionConfig {
  /** Markdown transformers contributed by the plugin. */
  markdownTransformers: Transformer[];
  /** Named Lexical commands the plugin exports for external dispatch. */
  commands: Readonly<Record<string, LexicalCommand<unknown>>>;
  /** Component-picker entries this plugin contributes. */
  userCommands: ReadonlyArray<UserCommand>;
  /** Dynamic component-picker option provider, if any. */
  getDynamicOptions:
    | ((queryString: string) => DynamicMenuOption[] | Promise<DynamicMenuOption[]>)
    | undefined;
  /** Opaque plugin-defined config (passed through verbatim from PluginPackage.config). */
  pluginConfig: unknown;
}

/**
 * Optional hook supplied by callers that want a real `register()` body. The
 * adapter cannot infer one from a PluginPackage today (registration logic
 * lives inside React components).
 */
export type PluginPackageRegisterFn = (
  editor: LexicalEditor,
  config: NimbalystExtensionConfig,
) => () => void;

export interface PluginPackageToExtensionOptions {
  /**
   * Resolve a string dependency name (as used by `PluginPackage.dependencies`)
   * to an actual extension instance. If omitted or the resolver returns
   * `undefined`, the dependency is skipped silently (matches today's
   * behavior where `PluginRegistry` does not enforce dependency presence).
   */
  resolveDependency?: (name: string) => LexicalExtension<any, any, any, any> | undefined;
  /**
   * Optional `register(editor, config) => cleanup` hook to attach Lexical-side
   * runtime behavior. The adapter does not synthesize one.
   */
  register?: PluginPackageRegisterFn;
}

function freezeCommands(
  commands: PluginPackage['commands'],
): Readonly<Record<string, LexicalCommand<unknown>>> {
  if (!commands) {
    return Object.freeze({});
  }
  return Object.freeze({ ...commands }) as Readonly<
    Record<string, LexicalCommand<unknown>>
  >;
}

function resolveDependencies(
  names: string[] | undefined,
  resolve: PluginPackageToExtensionOptions['resolveDependency'],
): LexicalExtension<any, any, any, any>[] | undefined {
  if (!names || names.length === 0 || !resolve) {
    return undefined;
  }
  const resolved: LexicalExtension<any, any, any, any>[] = [];
  for (const name of names) {
    const dep = resolve(name);
    if (dep) {
      resolved.push(dep);
    }
  }
  return resolved.length > 0 ? resolved : undefined;
}

/**
 * Convert a PluginPackage into a LexicalExtension.
 *
 * The resulting extension's `name` matches the package's `name`, its `nodes`
 * are the package's `nodes`, its `dependencies` are resolved through the
 * supplied resolver, and its `config` exposes Nimbalyst-side metadata
 * (transformers, commands, user commands, opaque config).
 */
export function pluginPackageToExtension(
  pkg: PluginPackage,
  options: PluginPackageToExtensionOptions = {},
): LexicalExtension<NimbalystExtensionConfig, string, undefined, undefined> {
  const config: NimbalystExtensionConfig = {
    markdownTransformers: pkg.transformers ? [...pkg.transformers] : [],
    commands: freezeCommands(pkg.commands),
    userCommands: pkg.userCommands ? [...pkg.userCommands] : [],
    getDynamicOptions: pkg.getDynamicOptions,
    pluginConfig: pkg.config,
  };

  const dependencies = resolveDependencies(
    pkg.dependencies,
    options.resolveDependency,
  );

  return defineExtension({
    name: pkg.name,
    nodes: pkg.nodes,
    dependencies,
    config,
    register: options.register
      ? (editor, mergedConfig) => options.register!(editor, mergedConfig)
      : undefined,
  }) as LexicalExtension<NimbalystExtensionConfig, string, undefined, undefined>;
}
