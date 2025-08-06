import type { PluginPackage } from '@stravu/stravu-editor';
import CardPlugin from './CardPlugin';
import { CardNode } from './CardNode';
import { CARD_TRANSFORMER } from './CardTransformer';
import { INSERT_CARD_COMMAND } from './CardPlugin';

export const CardPluginPackage: PluginPackage = {
  name: 'card',
  Component: CardPlugin,
  nodes: [CardNode],
  transformers: [CARD_TRANSFORMER],
  commands: {
    INSERT_CARD: INSERT_CARD_COMMAND,
  },
  userCommands: [
    {
      title: 'Card',
      description: 'Insert a card with title and content',
      icon: '🗂️',
      keywords: ['card', 'box', 'container', 'panel'],
      command: INSERT_CARD_COMMAND,
      payload: {},
    },
  ],
};
