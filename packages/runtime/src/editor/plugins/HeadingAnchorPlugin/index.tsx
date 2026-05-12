import {useEffect} from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import type {LexicalEditor} from 'lexical';
import {HeadingNode} from '@lexical/rich-text';

import {slugify} from '../../utils/headingSlug';

function recomputeHeadingIds(editor: LexicalEditor): void {
  const root = editor.getRootElement();
  if (!root) {
    return;
  }
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const taken = new Map<string, number>();
  headings.forEach((element) => {
    const text = element.textContent ?? '';
    const slug = slugify(text);
    if (!slug) {
      if (element.id) {
        element.removeAttribute('id');
      }
      return;
    }
    let candidate = slug;
    const count = taken.get(slug);
    if (count !== undefined) {
      const next = count + 1;
      candidate = `${slug}-${next}`;
      taken.set(slug, next);
    } else {
      taken.set(slug, 0);
    }
    if (element.id !== candidate) {
      element.id = candidate;
    }
  });
}

export function HeadingAnchorPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    recomputeHeadingIds(editor);
    return editor.registerMutationListener(
      HeadingNode,
      () => {
        recomputeHeadingIds(editor);
      },
      {skipInitialization: false},
    );
  }, [editor]);

  return null;
}
