import { describe, expect, it, vi } from 'vitest';
import { createCommand, type LexicalEditor } from 'lexical';
import { defineExtension } from '@lexical/extension';

import {
  pluginPackageToExtension,
  type NimbalystExtensionConfig,
} from '../pluginPackageToExtension';
import type { PluginPackage } from '../../types/PluginTypes';
import { MermaidNode } from '../../plugins/MermaidPlugin/MermaidNode';

describe('pluginPackageToExtension', () => {
  it('produces an extension that mirrors the package name and nodes', () => {
    const pkg: PluginPackage = {
      name: 'TestPlugin',
      nodes: [MermaidNode],
    };

    const ext = pluginPackageToExtension(pkg);

    expect(ext.name).toBe('TestPlugin');
    expect(ext.nodes).toEqual([MermaidNode]);
  });

  it('exposes transformers, commands, and user commands via extension config', () => {
    const INSERT_FOO = createCommand<void>('INSERT_FOO');
    const transformer: any = {
      type: 'element',
      regExp: /foo/,
      dependencies: [],
      replace: () => {},
      export: () => null,
    };
    const pkg: PluginPackage = {
      name: 'TestPlugin',
      transformers: [transformer],
      commands: { INSERT_FOO },
      userCommands: [
        {
          title: 'Foo',
          command: INSERT_FOO,
        },
      ],
    };

    const ext = pluginPackageToExtension(pkg);
    const config = ext.config as NimbalystExtensionConfig;

    expect(config.markdownTransformers).toEqual([transformer]);
    expect(config.commands).toEqual({ INSERT_FOO });
    expect(config.userCommands).toHaveLength(1);
    expect(config.userCommands[0].title).toBe('Foo');
  });

  it('resolves string dependencies through the supplied resolver', () => {
    const dependencyExtension = defineExtension({ name: 'DependencyExt' });
    const resolveDependency = vi
      .fn()
      .mockReturnValueOnce(dependencyExtension)
      .mockReturnValueOnce(undefined);

    const pkg: PluginPackage = {
      name: 'TestPlugin',
      dependencies: ['DependencyExt', 'MissingExt'],
    };

    const ext = pluginPackageToExtension(pkg, { resolveDependency });

    expect(resolveDependency).toHaveBeenCalledWith('DependencyExt');
    expect(resolveDependency).toHaveBeenCalledWith('MissingExt');
    expect(ext.dependencies).toEqual([dependencyExtension]);
  });

  it('omits dependencies when none resolve', () => {
    const pkg: PluginPackage = {
      name: 'TestPlugin',
      dependencies: ['MissingExt'],
    };

    const ext = pluginPackageToExtension(pkg, {
      resolveDependency: () => undefined,
    });

    expect(ext.dependencies).toBeUndefined();
  });

  it('forwards a caller-supplied register fn with the merged config', () => {
    const register = vi.fn(() => vi.fn());
    const pkg: PluginPackage = {
      name: 'TestPlugin',
    };

    const ext = pluginPackageToExtension(pkg, { register });
    expect(typeof ext.register).toBe('function');

    const fakeEditor = {} as LexicalEditor;
    const cleanup = ext.register?.(
      fakeEditor,
      ext.config as NimbalystExtensionConfig,
      {} as any,
    );

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(fakeEditor, ext.config as NimbalystExtensionConfig);
    expect(typeof cleanup).toBe('function');
  });

  it('passes through opaque PluginPackage.config as pluginConfig', () => {
    interface FooConfig {
      flag: boolean;
    }
    const pkg: PluginPackage<FooConfig> = {
      name: 'TestPlugin',
      config: { flag: true },
    };

    const ext = pluginPackageToExtension(pkg);
    const config = ext.config as NimbalystExtensionConfig;

    expect(config.pluginConfig).toEqual({ flag: true });
  });
});
