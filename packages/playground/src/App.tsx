import React, { useState } from 'react';
import { StravuEditor, pluginRegistry } from 'stravu-editor';
import Settings from './Settings';
import { SettingsContext, SETTINGS, DEFAULT_SETTINGS, type SettingName } from './SettingsContext';
import { INITIAL_SETTINGS } from './appSettings';
import { README_CONTENT } from './readmeContent';
import { MathPluginPackage } from './plugins/MathPlugin/MathPluginPackage';
import { CardPluginPackage } from './plugins/CardPlugin/CardPluginPackage';
import { TEST_CONTENT } from "@/testContent.ts";

// Register custom plugins immediately (not in useEffect)
// This ensures they're available when StravuEditor initializes
pluginRegistry.register({
  ...MathPluginPackage,
  config: {
    renderEngine: 'simple'
  }
});

pluginRegistry.register(CardPluginPackage);

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
        <StravuEditor config={{
          ...settings,
          // initialContent: README_CONTENT,
          initialContent: TEST_CONTENT,
          emptyEditor: false,
        }} />
        <Settings />
      </div>
    </SettingsContext.Provider>
  );
}
