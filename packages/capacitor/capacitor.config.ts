import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nimbalyst.app',
  appName: 'Nimbalyst',
  webDir: 'dist',
  // avoid builtin logging because it logs the sensitive encryption key like a dumbass
  // loggingBehavior: 'none',
  // Use Vite dev server for HMR during development
  // server: {
  //   url: 'http://192.168.1.253:4102',
  //   cleartext: true
  // },
  ios: {
    // contentInset removed - causes issues with safe area handling
  },
};

export default config;
