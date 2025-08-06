import type { ElementTransformer } from '@lexical/markdown';
import { $createCardNode, $isCardNode, CardNode } from './CardNode';
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical';

export const CARD_TRANSFORMER: ElementTransformer = {
  dependencies: [CardNode],
  export: (node) => {
    if (!$isCardNode(node)) {
      return null;
    }
    
    const children = node.getChildren();
    const titleText = children[0]?.getTextContent() || '';
    const contentTexts = children.slice(1).map(child => child.getTextContent());
    const contentText = contentTexts.join('\n');
    
    return `:::card\n# ${titleText}\n---\n${contentText}\n:::`;
  },
  regExp: /^:::card$/,
  replace: (parentNode, children, match, isImport) => {
    const cardNode = CardNode.createWithContent();
    
    parentNode.replace(cardNode);
  },
  type: 'element',
};
