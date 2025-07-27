import type {Context} from 'react';

import * as React from 'react';

export type SettingName =
  | 'disableBeforeInput'
  | 'emptyEditor'
  | 'isCollab'
  | 'isAutocomplete'
  | 'isMaxLength'
  | 'isCharLimit'
  | 'isCharLimitUtf8'
  | 'isRichText'
  | 'measureTypingPerf'
  | 'showNestedEditorTreeView'
  | 'showTableOfContents'
  | 'shouldUseLexicalContextMenu'
  | 'tableCellMerge'
  | 'tableCellBackgroundColor';

export type Settings = Record<SettingName, boolean>;

const DEFAULT_SETTINGS: Settings = {
  disableBeforeInput: false,
  emptyEditor: false,
  isCollab: false,
  isAutocomplete: false,
  isMaxLength: false,
  isCharLimit: false,
  isCharLimitUtf8: false,
  isRichText: true,
  measureTypingPerf: false,
  showNestedEditorTreeView: false,
  showTableOfContents: false,
  shouldUseLexicalContextMenu: false,
  tableCellMerge: true,
  tableCellBackgroundColor: true,
};

// In case we add settings we can't write the localStorage to avoid users with older
// settings stuck with newer settings.
const SETTINGS_WRITE_DENY_LIST: Array<SettingName> = [];

type SettingsContextShape = {
  setOption: (name: SettingName, value: boolean) => void;
  settings: Settings;
};

export const SettingsContext: Context<SettingsContextShape> =
  React.createContext({
    setOption: (name: SettingName, value: boolean) => {
      return;
    },
    settings: DEFAULT_SETTINGS,
  });

export function useSettings(): SettingsContextShape {
  return React.useContext(SettingsContext);
}

const hostName = window.location.hostname;
export const isDevPlayground: boolean =
  hostName !== 'playground.lexical.dev' &&
  hostName !== 'lexical-playground.vercel.app';

export const DEFAULT_SETTINGS_EXAMPLE_CODE = (
  isDevPlayground ? DEFAULT_SETTINGS : {...DEFAULT_SETTINGS, isCollab: true}
) as Settings;

let SETTINGS: Settings = DEFAULT_SETTINGS_EXAMPLE_CODE;

if (typeof window !== 'undefined') {
  const settingsString = window.localStorage.getItem('stravu-editor-settings');
  
  if (settingsString) {
    try {
      const settingsParsed = JSON.parse(settingsString);
      if (typeof settingsParsed === 'object') {
        SETTINGS = {...SETTINGS, ...settingsParsed};
      }
    } catch (e) {
      console.warn('Unable to parse settings from localStorage', e);
    }
  }
  
  window.localStorage.setItem(
    'stravu-editor-settings',
    JSON.stringify({
      ...DEFAULT_SETTINGS_EXAMPLE_CODE,
      ...SETTINGS,
    }),
  );
}

export {DEFAULT_SETTINGS, SETTINGS};