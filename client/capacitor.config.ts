import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.collabboard.app',
  appName: 'CollabBoard',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    cleartext: false,
    allowNavigation: ['collabboard-production-8eec.up.railway.app']
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    initialFocus: true,
  },
};

export default config;