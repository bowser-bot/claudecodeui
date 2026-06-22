import { IS_PLATFORM, getWsOrigin } from '../../../constants/config';
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

export function getShellWebSocketUrl(): string | null {
  // Same-origin on web; the configured remote origin in the native app.
  const wsOrigin = getWsOrigin();

  if (IS_PLATFORM) {
    return `${wsOrigin}/shell`;
  }

  const token = localStorage.getItem('auth-token');
  if (!token) {
    console.error('No authentication token found for Shell WebSocket connection');
    return null;
  }

  return `${wsOrigin}/shell?token=${encodeURIComponent(token)}`;
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: WebSocket | null, message: ShellOutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}