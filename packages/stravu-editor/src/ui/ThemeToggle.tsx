/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {useTheme} from '../context/ThemeContext';

import './ThemeToggle.css';

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({className = ''}: ThemeToggleProps): JSX.Element {
  const {theme, toggleTheme} = useTheme();

  return (
    <button
      className={`theme-toggle ${className}`}
      onClick={toggleTheme}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      <span className={`theme-toggle-icon ${theme}`}>
        {theme === 'light' ? '🌙' : '☀️'}
      </span>
    </button>
  );
}