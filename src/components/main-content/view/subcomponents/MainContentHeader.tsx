import { useCallback, useRef, useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { MainContentHeaderProps } from '../../types/types';
import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  isMobile,
  onMenuClick,
  onBack,
}: MainContentHeaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState]);

  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && (onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <MobileMenuButton onMenuClick={onMenuClick} />
          ))}
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>

        <div className="relative min-w-0 flex-shrink overflow-hidden sm:flex-shrink-0">
          {canScrollLeft && (
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
          )}
          <div
            ref={scrollRef}
            onScroll={updateScrollState}
            className="scrollbar-hide overflow-x-auto"
          >
            <MainContentTabSwitcher
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              shouldShowTasksTab={shouldShowTasksTab}
              shouldShowBrowserTab={shouldShowBrowserTab}
            />
          </div>
          {canScrollRight && (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}
