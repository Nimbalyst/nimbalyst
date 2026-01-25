/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';


type Props = Readonly<{
  'data-test-id'?: string;
  accept?: string;
  label: string;
  onChange: (files: FileList | null) => void;
}>;

export default function FileInput({
  accept,
  label,
  onChange,
  'data-test-id': dataTestId,
}: Props): JSX.Element {
  return (
    <div className="Input__wrapper flex flex-row items-center mb-[10px]">
      <label className="Input__label flex flex-1 text-[#666] dark:text-[var(--nim-text-muted)]">
        {label}
      </label>
      <input
        type="file"
        accept={accept}
        className="Input__input flex flex-[2] border border-[#999] py-[7px] px-[10px] text-base rounded-[5px] min-w-0 bg-white text-[#333] dark:border-[var(--nim-border)] dark:bg-[var(--nim-bg-secondary)] dark:text-[var(--nim-text)]"
        onChange={(e) => onChange(e.target.files)}
        data-test-id={dataTestId}
      />
    </div>
  );
}
