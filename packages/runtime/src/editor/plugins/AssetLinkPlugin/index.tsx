import { useEffect } from 'react';
import { isDOMNode } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

function getAssetLinkElement(target: Node): HTMLAnchorElement | null {
  const targetElement =
    typeof Element !== 'undefined' && target instanceof Element
      ? target
      : target.parentElement;

  const anchor = targetElement?.closest('a[href^="collab-asset://"]');
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

export default function AssetLinkPlugin({
  onOpenAssetLink,
}: {
  onOpenAssetLink?: (href: string) => Promise<void> | void;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onOpenAssetLink) {
      return;
    }

    const handleAssetClick = (event: MouseEvent, allowButton: (button: number) => boolean) => {
      if (event.defaultPrevented || !allowButton(event.button)) {
        return;
      }

      const target = event.target;
      if (!isDOMNode(target)) {
        return;
      }

      const anchor = getAssetLinkElement(target);
      if (!anchor) {
        return;
      }

      event.preventDefault();
      void Promise.resolve(onOpenAssetLink(anchor.href)).catch(error => {
        console.error('Failed to open collaborative attachment', error);
      });
    };

    const onClick = (event: MouseEvent) => handleAssetClick(event, button => button === 0);
    const onAuxClick = (event: MouseEvent) => handleAssetClick(event, button => button === 1);

    return editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement) {
        prevRootElement.removeEventListener('click', onClick, true);
        prevRootElement.removeEventListener('auxclick', onAuxClick, true);
      }
      if (!rootElement) {
        return undefined;
      }

      rootElement.addEventListener('click', onClick, true);
      rootElement.addEventListener('auxclick', onAuxClick, true);
      return () => {
        rootElement.removeEventListener('click', onClick, true);
        rootElement.removeEventListener('auxclick', onAuxClick, true);
      };
    });
  }, [editor, onOpenAssetLink]);

  return null;
}
