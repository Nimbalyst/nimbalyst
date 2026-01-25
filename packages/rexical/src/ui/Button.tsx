/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {ReactNode} from 'react';

import joinClasses from '../utils/joinClasses';

export default function Button({
  'data-test-id': dataTestId,
  children,
  className,
  onClick,
  disabled,
  small,
  title,
}: {
  'data-test-id'?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  small?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <button
      disabled={disabled}
      className={joinClasses(
        'Button__root',
        'border-0 rounded-[5px] cursor-pointer text-sm',
        'bg-[#eee] text-[#333] hover:bg-[#ddd]',
        'dark:bg-[var(--nim-bg-tertiary)] dark:text-[var(--nim-text)] dark:hover:bg-[var(--nim-bg-hover)]',
        small ? 'py-[5px] px-[10px] text-[13px]' : 'py-[10px] px-[15px]',
        disabled && 'Button__disabled cursor-not-allowed dark:bg-[var(--nim-bg-secondary)] dark:text-[var(--nim-text-muted)] hover:bg-[#eee] dark:hover:bg-[var(--nim-bg-secondary)]',
        className,
      )}
      onClick={onClick}
      title={title}
      aria-label={title}
      {...(dataTestId && {'data-test-id': dataTestId})}>
      {children}
    </button>
  );
}
