import { useEffect, useState } from 'react';

type UseDeviceSettingsOptions = {
  mobileBreakpoint?: number;
  trackMobile?: boolean;
  trackPWA?: boolean;
};

const getIsMobile = (mobileBreakpoint: number): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.innerWidth < mobileBreakpoint;
};

const getIsPWA = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  // The Capacitor native shell is a standalone, app-like surface even though it
  // doesn't report display-mode: standalone — treat it as PWA so the safe-area /
  // mobile-standalone styling (pwa-mode) applies.
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const isNative = Boolean(capacitor?.isNativePlatform?.());

  return (
    isNative ||
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean(navigatorWithStandalone.standalone) ||
    document.referrer.includes('android-app://')
  );
};

export function useDeviceSettings(options: UseDeviceSettingsOptions = {}) {
  const {
    mobileBreakpoint = 768,
    trackMobile = true,
    trackPWA = true
  } = options;

  const [isMobile, setIsMobile] = useState<boolean>(() => (
    trackMobile ? getIsMobile(mobileBreakpoint) : false
  ));
  const [isPWA, setIsPWA] = useState<boolean>(() => (
    trackPWA ? getIsPWA() : false
  ));

  useEffect(() => {
    if (!trackMobile || typeof window === 'undefined') {
      return;
    }

    const checkMobile = () => {
      setIsMobile(getIsMobile(mobileBreakpoint));
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, [mobileBreakpoint, trackMobile]);

  useEffect(() => {
    if (!trackPWA || typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const checkPWA = () => {
      setIsPWA(getIsPWA());
    };

    checkPWA();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', checkPWA);
      return () => {
        mediaQuery.removeEventListener('change', checkPWA);
      };
    }

    mediaQuery.addListener(checkPWA);
    return () => {
      mediaQuery.removeListener(checkPWA);
    };
  }, [trackPWA]);

  return { isMobile, isPWA };
}
