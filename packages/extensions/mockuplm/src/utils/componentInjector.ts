/**
 * Component Injector
 *
 * Injects the built-in nim-* web components and optional repo components
 * into a mockup iframe document. Components are registered as custom
 * elements and immediately available for use in mockup HTML.
 */

import { BUILTIN_COMPONENTS_SCRIPT } from '../components-lib';

const SCRIPT_ID = 'nimbalyst-components';

/**
 * Inject built-in nim-* components into a mockup iframe document.
 * Safe to call multiple times -- re-injection is skipped if already present.
 */
export function injectComponents(iframeDoc: Document): void {
  // Skip if already injected
  if (iframeDoc.getElementById(SCRIPT_ID)) return;

  const script = iframeDoc.createElement('script');
  script.id = SCRIPT_ID;
  script.textContent = BUILTIN_COMPONENTS_SCRIPT;
  iframeDoc.head.appendChild(script);
}
