/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {MarkdownShortcutPlugin} from '@lexical/react/LexicalMarkdownShortcutPlugin';

import {MARKDOWN_TRANSFORMERS} from '../../markdown';

export default function MarkdownPlugin(): JSX.Element {
  return <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />;
}
