import { Fragment, useEffect } from 'react';

import { getSessionDate } from '../../utils/utils';
import type { SidebarProjectListProps } from './SidebarProjectList';
import SidebarProjectsState from './SidebarProjectsState';
import SidebarSessionItem from './SidebarSessionItem';

type RecencyBucket = 'today' | 'yesterday' | 'week' | 'month' | 'earlier';

const DAY_MS = 86_400_000;

function recencyBucket(date: Date, now: Date): RecencyBucket {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ms = date.getTime();
  if (Number.isNaN(ms)) return 'earlier';
  if (ms >= startOfToday) return 'today';
  if (ms >= startOfToday - DAY_MS) return 'yesterday';
  if (ms >= startOfToday - 6 * DAY_MS) return 'week';
  if (ms >= startOfToday - 29 * DAY_MS) return 'month';
  return 'earlier';
}

function bucketLabel(b: RecencyBucket, t: SidebarProjectListProps['t']): string {
  switch (b) {
    case 'today':
      return t('sidebar.recency.today', 'Today');
    case 'yesterday':
      return t('sidebar.recency.yesterday', 'Yesterday');
    case 'week':
      return t('sidebar.recency.week', 'This Week');
    case 'month':
      return t('sidebar.recency.month', 'This Month');
    default:
      return t('sidebar.recency.earlier', 'Earlier');
  }
}

/**
 * Flat, conversation-first sidebar body. Instead of grouping by project/folder,
 * it renders a single recency-sorted list of every loaded session across all
 * (filtered) projects, tagging each row with its owning folder as a secondary
 * label. Rendered for the "Conversations" sidebar tab (the default mode).
 *
 * Reuses {@link SidebarProjectListProps} (same handlers as the grouped view) so
 * selection, rename, delete and bookmark behave identically — only the layout
 * differs. Sessions are whatever the server has loaded per project (the most
 * recent N each); deeper history still loads via the grouped view's per-project
 * "load more".
 */
export default function SidebarConversationList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  currentTime,
  editingSession,
  editingSessionName,
  activeSessions,
  getProjectSessions,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  isBookmarked,
  onToggleBookmark,
  t,
}: SidebarProjectListProps) {
  useEffect(() => {
    let baseTitle = 'CloudCLI UI';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  const conversations = filteredProjects
    .flatMap((project) => getProjectSessions(project).map((session) => ({ project, session })))
    .sort((a, b) => getSessionDate(b.session).getTime() - getSessionDate(a.session).getTime());

  if (isLoading || conversations.length === 0) {
    return (
      <SidebarProjectsState
        isLoading={isLoading}
        loadingProgress={loadingProgress}
        projectsCount={projects.length}
        filteredProjectsCount={filteredProjects.length}
        t={t}
      />
    );
  }

  const now = new Date();
  let lastBucket: RecencyBucket | null = null;

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {conversations.map(({ project, session }) => {
        const bucket = recencyBucket(getSessionDate(session), now);
        const showHeader = bucket !== lastBucket;
        lastBucket = bucket;
        return (
          <Fragment key={`${project.projectId}:${session.id}`}>
            {showHeader && (
              <div className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-1">
                {bucketLabel(bucket, t)}
              </div>
            )}
            <SidebarSessionItem
              project={project}
              session={session}
              selectedSession={selectedSession}
              isProcessing={activeSessions.has(session.id)}
              currentTime={currentTime}
              editingSession={editingSession}
              editingSessionName={editingSessionName}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              onProjectSelect={onProjectSelect}
              onSessionSelect={onSessionSelect}
              onDeleteSession={onDeleteSession}
              isBookmarked={isBookmarked(session.id)}
              onToggleBookmark={onToggleBookmark}
              projectLabel={project.displayName}
              t={t}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
