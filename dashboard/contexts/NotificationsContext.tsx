"use client";
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useWebSocket } from '../hooks/useWebSocket';
import { API_URL, WS_URL } from '../lib/constants';

export interface NotificationItem {
  id:       number;
  ts:       string;
  type:     string;
  severity: 'error' | 'warning' | 'info';
  source:   string;
  message:  string;
  read:     boolean;
}

interface WsNotifyMsg {
  type:   string;
  items?: NotificationItem[];
  unread?: number;
}

interface Ctx {
  unread: number;
  markAllRead: () => Promise<void>;
  refreshUnread: () => Promise<void>;
}

const NotificationsContext = createContext<Ctx>({
  unread: 0,
  markAllRead: async () => {},
  refreshUnread: async () => {},
});

export const useNotifications = () => useContext(NotificationsContext);

function toastFor(n: NotificationItem) {
  const title = n.source === 'system' ? 'System' : n.source;
  const opts = { description: n.message };
  if (n.severity === 'error')      toast.error(title, opts);
  else if (n.severity === 'warning') toast.warning(title, opts);
  else                              toast.info(title, opts);
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);

  // The WS server starts each connection from the current tip, so messages it
  // sends are genuinely new — safe to toast without replaying history.
  const { lastMessage } = useWebSocket<WsNotifyMsg>(`${WS_URL}/ws/notifications`);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/notifications/unread-count`);
      if (res.ok) {
        const j = await res.json();
        setUnread(j.unread ?? 0);
      }
    } catch { /* backend down — leave count as-is */ }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/notifications/read-all`, { method: 'POST' });
    } catch { /* ignore */ }
    setUnread(0);
  }, []);

  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'notifications' || !lastMessage.items) return;
    lastMessage.items.forEach(toastFor);
    if (typeof lastMessage.unread === 'number') setUnread(lastMessage.unread);
    else setUnread(c => c + (lastMessage.items?.length ?? 0));
  }, [lastMessage]);

  return (
    <NotificationsContext.Provider value={{ unread, markAllRead, refreshUnread }}>
      {children}
    </NotificationsContext.Provider>
  );
}
