import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

// User-selectable text size → root font multiplier (consumed by --text-scale
// in index.css). 'medium' (1.0) is the default and matches the prior behavior.
export const TEXT_SIZE_SCALE = {
  small: 0.9,
  medium: 1,
  large: 1.15,
  xlarge: 1.3,
};
export const TEXT_SIZE_ORDER = ['small', 'medium', 'large', 'xlarge'];

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // Check for saved theme preference or default to system preference
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      return savedTheme === 'dark';
    }
    
    // Check system preference
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    
    return false;
  });

  // Text size preference (per device). Defaults to 'medium'.
  const [textSize, setTextSizeState] = useState(() => {
    const saved = localStorage.getItem('textSize');
    return saved && TEXT_SIZE_SCALE[saved] ? saved : 'medium';
  });

  const setTextSize = (size) => {
    if (TEXT_SIZE_SCALE[size]) {
      setTextSizeState(size);
    }
  };

  // Apply the text-size preference by scaling the root font via --text-scale.
  useEffect(() => {
    const scale = TEXT_SIZE_SCALE[textSize] ?? 1;
    document.documentElement.style.setProperty('--text-scale', String(scale));
    localStorage.setItem('textSize', textSize);
  }, [textSize]);

  // Update document class and localStorage when theme changes
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      
      // Update iOS status bar style and theme color for dark mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'black-translucent');
      }
      
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#0c1117'); // Dark background color (hsl(222.2 84% 4.9%))
      }
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      
      // Update iOS status bar style and theme color for light mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }
      
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#ffffff'); // Light background color
      }
    }
  }, [isDarkMode]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      // Only update if user hasn't manually set a preference
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  const value = {
    isDarkMode,
    toggleDarkMode,
    textSize,
    setTextSize,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};