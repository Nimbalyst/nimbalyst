/**
 * Register the DiffApprovalBarPlugin with the Electron app
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DiffApprovalBarPlugin } from '@nimbalyst/runtime';

/**
 * Registers the DiffApprovalBarPlugin globally
 */
export function registerDiffApprovalBarPlugin() {
  // Create a hidden container for the plugin
  const container = document.createElement('div');
  container.id = 'diff-approval-bar-plugin-root';
  container.style.display = 'none';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(<DiffApprovalBarPlugin />);
}
