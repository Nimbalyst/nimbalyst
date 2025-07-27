import React, { useState } from 'react';
import { StravuEditor } from 'stravu-editor';
import Settings from './Settings';
import { SettingsContext, SETTINGS, DEFAULT_SETTINGS, type SettingName } from './SettingsContext';
import { INITIAL_SETTINGS } from './appSettings';

export default function App(): JSX.Element {
  const [settings, setSettings] = useState({...DEFAULT_SETTINGS, ...INITIAL_SETTINGS});

  return (
    <SettingsContext.Provider
      value={{
        setOption: (name: SettingName, value: boolean) => {
          const newSettings = {...settings, [name]: value};
          setSettings(newSettings);
          SETTINGS[name] = value;
          window.localStorage.setItem(
            'stravu-editor-settings',
            JSON.stringify(SETTINGS),
          );
        },
        settings,
      }}>
      <div className="editor-shell">
        <StravuEditor config={settings} />
        <Settings />
      </div>
    </SettingsContext.Provider>
  );
}