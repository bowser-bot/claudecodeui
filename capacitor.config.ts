import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native (Android) shell for CloudCLI.
 *
 * The web frontend is bundled into the app (webDir below) and talks to a remote
 * CloudCLI server over the network. The default server origin is baked in at
 * build time via VITE_DEFAULT_SERVER_ORIGIN and can be overridden in-app.
 *
 * Build flow:
 *   VITE_DEFAULT_SERVER_ORIGIN=https://cloudcli.bowser.prooftech.dev \
 *     npx vite build --outDir dist-app
 *   npx cap sync android
 *
 * webDir is `dist-app` (separate from the web deployment's `dist/`) so building
 * the app never clobbers the same-origin web build served on :3001.
 */
const config: CapacitorConfig = {
  appId: 'dev.prooftech.cloudcli',
  appName: 'CloudCLI',
  webDir: 'dist-app',
  android: {
    // App is served from https://localhost and talks to an https backend, so
    // no cleartext is needed for the default (domain) configuration.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      // Backstop auto-hide; the app also hides it from JS once the shell is up.
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0b0b0c',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
