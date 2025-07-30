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
import {AutocompleteNode} from '../plugins/AutocompletePlugin/AutocompleteNode.tsx';
import {EmojiNode} from '../plugins/EmojisPlugin/EmojiNode.tsx';
import {ExcalidrawNode} from '../plugins/ExcalidrawPlugin/ExcalidrawNode';
import {FigmaNode} from '../plugins/FigmaPlugin/FigmaNode.tsx';
import {ImageNode} from '../plugins/ImagesPlugin/ImageNode';
import {InlineImageNode} from '../plugins/InlineImagePlugin/InlineImageNode/InlineImageNode';
import {KeywordNode} from '../plugins/KeywordsPlugin/KeywordNode.ts';
import {LayoutContainerNode} from '../plugins/LayoutPlugin/LayoutContainerNode.ts';
import {LayoutItemNode} from '../plugins/LayoutPlugin/LayoutItemNode.ts';
import {MentionNode} from '../plugins/MentionsPlugin/MentionNode.ts';
import {PageBreakNode} from '../plugins/PageBreakPlugin/PageBreakNode';
import {PollNode} from '../plugins/PollPlugin/PollNode.tsx';
import {SpecialTextNode} from '../plugins/SpecialTextPlugin/SpecialTextNode.tsx';
import {StickyNode} from '../plugins/StickyPlugin/StickyNode.tsx';
import {TweetNode} from '../plugins/TwitterPlugin/TweetNode.tsx';
import {YouTubeNode} from '../plugins/YouTubePlugin/YouTubeNode.tsx';

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
  PollNode,
  StickyNode,
  ImageNode,
  InlineImageNode,
  MentionNode,
  EmojiNode,
  ExcalidrawNode,
  AutocompleteNode,
  KeywordNode,
  HorizontalRuleNode,
  TweetNode,
  YouTubeNode,
  FigmaNode,
  MarkNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  PageBreakNode,
  LayoutContainerNode,
  LayoutItemNode,
  SpecialTextNode,

    // ThemelessCodeNode,
    // {
    //     replace: CodeNode,
    //     with: (CodeNode) => {
    //         return ThemelessCodeNode.clone(CodeNode);
    //     },
    //     withKlass: ThemelessCodeNode
    //
    // }

];

export default EditorNodes;
