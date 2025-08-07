/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {Klass, LexicalNode} from 'lexical';

import {CodeHighlightNode, CodeNode} from '@lexical/code';
import {HashtagNode} from '@lexical/hashtag';
import {AutoLinkNode, LinkNode} from '@lexical/link';
import {ListItemNode, ListNode} from '@lexical/list';
import {MarkNode} from '@lexical/mark';
import {OverflowNode} from '@lexical/overflow';
import {HorizontalRuleNode} from '@lexical/react/LexicalHorizontalRuleNode';
import {HeadingNode, QuoteNode} from '@lexical/rich-text';
import {TableCellNode, TableNode, TableRowNode} from '@lexical/table';

import {CollapsibleContainerNode} from '../plugins/CollapsiblePlugin/CollapsibleContainerNode';
import {CollapsibleContentNode} from '../plugins/CollapsiblePlugin/CollapsibleContentNode';
import {CollapsibleTitleNode} from '../plugins/CollapsiblePlugin/CollapsibleTitleNode';
import {EmojiNode} from '../plugins/EmojisPlugin/EmojiNode.tsx';
import {ExcalidrawNode} from '../plugins/ExcalidrawPlugin/ExcalidrawNode';
import {ImageNode} from '../plugins/ImagesPlugin/ImageNode';
import {InlineImageNode} from '../plugins/InlineImagePlugin/InlineImageNode/InlineImageNode';
import {LayoutContainerNode} from '../plugins/LayoutPlugin/LayoutContainerNode.ts';
import {LayoutItemNode} from '../plugins/LayoutPlugin/LayoutItemNode.ts';
import {PageBreakNode} from '../plugins/PageBreakPlugin/PageBreakNode';
// import { $createThemelessCodeNode, ThemelessCodeNode } from '../plugins/CodeHighlightShikiPlugin/ThemelessCodeNode.ts';

const EditorNodes: Array<Klass<LexicalNode>> = [
  HeadingNode,
  ListNode,
  ListItemNode,
  QuoteNode,
  CodeNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  HashtagNode,
  CodeHighlightNode,
  AutoLinkNode,
  LinkNode,
  OverflowNode,
  ImageNode,
  InlineImageNode,
  EmojiNode,
  ExcalidrawNode,
  HorizontalRuleNode,

  MarkNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  PageBreakNode,
  LayoutContainerNode,
  LayoutItemNode,

    // ThemelessCodeNode,
    // {
    //     replace: CodeNode,
    //     with: (CodeNode) => {
    //         return $createThemelessCodeNode();
    //     },
    //     withKlass: ThemelessCodeNode
    //
    // }

];

export default EditorNodes;
