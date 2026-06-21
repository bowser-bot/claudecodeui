import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, X } from 'lucide-react';

import type { QueuedMessage } from '../../hooks/useChatComposerState';

type QueuedMessagesProps = {
  queue: QueuedMessage[];
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onEdit: (id: string, text: string) => void;
};

/**
 * Prompts queued while a run is active — shown above the composer, sent
 * one-by-one as the agent finishes. Each row can be edited, reordered, or removed.
 */
export default function QueuedMessages({ queue, onRemove, onMove, onEdit }: QueuedMessagesProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  if (queue.length === 0) {
    return null;
  }

  const startEdit = (item: QueuedMessage) => {
    setEditingId(item.id);
    setDraft(item.text);
  };

  const commitEdit = () => {
    if (editingId && draft.trim()) {
      onEdit(editingId, draft.trim());
    }
    setEditingId(null);
    setDraft('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  return (
    <div className="mb-2 space-y-1">
      <div className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Queued ({queue.length}) · sent when the agent finishes
      </div>
      {queue.map((item, index) => {
        const isEditing = editingId === item.id;
        return (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5"
          >
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{index + 1}.</span>

            {isEditing ? (
              <textarea
                ref={editRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    commitEdit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEdit();
                  }
                }}
                rows={1}
                className="min-h-[1.75rem] min-w-0 flex-1 resize-none rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span
                className="min-w-0 flex-1 cursor-text truncate text-xs text-foreground"
                title={item.text}
                onDoubleClick={() => startEdit(item)}
              >
                {item.text}
              </span>
            )}

            {item.images.length > 0 && (
              <span className="shrink-0 text-[10px] text-muted-foreground">📎 {item.images.length}</span>
            )}

            <div className="flex shrink-0 items-center gap-0.5">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    aria-label="Save edit"
                    onClick={commitEdit}
                    className="rounded p-0.5 text-green-600 hover:bg-green-500/10 dark:text-green-400"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel edit"
                    onClick={cancelEdit}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Edit queued message"
                    onClick={() => startEdit(item)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => onMove(item.id, 'up')}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === queue.length - 1}
                    onClick={() => onMove(item.id, 'down')}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove from queue"
                    onClick={() => onRemove(item.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
