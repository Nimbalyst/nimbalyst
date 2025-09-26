/**
 * Plugin Manager Component
 * Renders all registered plugins inside the Lexical context
 */

import React from 'react';
import { pluginRegistry } from './PluginRegistry';

export function PluginManager(): JSX.Element {
  const plugins = pluginRegistry.getAll();

  return (
    <>
      {plugins.map(plugin => {
        // Only render plugins that have a Component
        if (!plugin.Component) {
          return null;
        }

        const Component = plugin.Component;
        const config = plugin.config || {};

        return <Component key={plugin.name} {...config} />;
      })}
    </>
  );
}
