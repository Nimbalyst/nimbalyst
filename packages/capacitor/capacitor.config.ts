import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nimbalyst.app',
  appName: 'Nimbalyst',
  webDir: 'dist',
  // Use Vite dev server for HMR during development
  // server: {
  //   url: 'http://192.168.1.253:4102',
  //   cleartext: true
  // },
  ios: {
    // Required for env(safe-area-inset-*) to work properly
    contentInset: 'always',
  },
};

export default config;
