import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.collabboard.app',
  appName: 'CollabBoard',
  webDir: 'build',
  server: {
    androidScheme: 'http',
    cleartext: true
  }
};

export default config;