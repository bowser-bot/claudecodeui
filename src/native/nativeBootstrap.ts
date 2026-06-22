import { Capacitor } from '@capacitor/core';

/**
 * Native (Capacitor) polish. No-op on web — the plugin modules are dynamically
 * imported only on a native platform, so they stay out of the web bundle.
 *
 * - Status bar: themed for the dark UI, not overlapping content.
 * - Hardware back: navigate within the SPA; exit only at the root.
 * - Splash: hidden as soon as the shell mounts (snappier than the timed backstop).
 */
export async function initNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
      import('@capacitor/app'),
    ]);

    // Embrace edge-to-edge (forced on Android 15+): the web view draws under a
    // transparent status bar and the app's CSS safe-area padding (pwa-mode #root
    // padding-top: env(safe-area-inset-top)) keeps content clear of it. Style.Dark
    // = light icons for the dark UI.
    try {
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: Style.Dark });
    } catch {
      /* status bar styling is non-critical */
    }

    // Android hardware back button: step back through SPA history, exit at root.
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.exitApp();
      }
    });

    try {
      await SplashScreen.hide();
    } catch {
      /* auto-hide backstop covers this */
    }
  } catch (err) {
    console.warn('Native init failed:', err);
  }
}
