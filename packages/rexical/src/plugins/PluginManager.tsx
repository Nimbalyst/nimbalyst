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
        const Component = plugin.Component;
        const config = plugin.config || {};
        
        return <Component key={plugin.name} {...config} />;
      })}
    </>
  );
}
