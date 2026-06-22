import { useEffect, useState } from 'react';
import { Download, FileDown, Loader2 } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

/** Download card for a file the agent delivered via send_user_file. Images render a thumbnail. */
export default function FileAttachmentCard({
  attachment,
}: {
  attachment: { name: string; size: number; url: string };
}) {
  const isImage = IMAGE_RE.test(attachment.name || '');
  const [downloading, setDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // For images, fetch the (authenticated) blob once and show it inline.
  useEffect(() => {
    if (!isImage || !attachment.url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await authenticatedFetch(attachment.url);
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch {
        /* fall back to the download chip */
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImage, attachment.url]);

  const triggerDownload = (objectUrl: string) => {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = attachment.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownload = async () => {
    if (downloading || !attachment.url) return;
    // Reuse the already-fetched image blob if we have it.
    if (previewUrl) {
      triggerDownload(previewUrl);
      return;
    }
    setDownloading(true);
    try {
      const res = await authenticatedFetch(attachment.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('File download failed', err);
    } finally {
      setDownloading(false);
    }
  };

  if (isImage && previewUrl) {
    return (
      <button
        type="button"
        onClick={handleDownload}
        className="group block w-full max-w-md overflow-hidden rounded-xl border border-border/70 bg-card/80 text-left shadow-sm transition-colors hover:border-primary/30"
      >
        <img
          src={previewUrl}
          alt={attachment.name}
          className="max-h-72 w-full bg-muted/30 object-contain"
        />
        <span className="flex items-center gap-2 p-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{attachment.name}</span>
            <span className="block text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
          </span>
          <span className="flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary">
            <Download className="h-4 w-4" />
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="group flex w-full max-w-md items-center gap-3 rounded-xl border border-border/70 bg-card/80 p-3 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-accent/40 disabled:opacity-70"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileDown className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
      </span>
      <span className="flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary">
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </span>
    </button>
  );
}
