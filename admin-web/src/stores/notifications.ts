import { create } from "zustand";

import { api } from "@/lib/api";
import type { AppNotification, Page } from "@/lib/types";

interface NotificationsState {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  fetch: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  // Called by the WS listener when a `notification_new` envelope arrives.
  // We optimistically prepend a synthetic row and then refresh from the
  // server to pick up the canonical record.
  pushIncoming: (envelope: { id?: string; title?: string; body?: string; category?: string }) => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,

  fetch: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [list, count] = await Promise.all([
        api.get<Page<AppNotification>>("/notifications", { params: { size: 50 } }),
        api.get<{ count: number }>("/notifications/unread-count"),
      ]);
      set({ items: list.data.items, unread: count.data.count, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  markRead: async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // The optimistic update below stays even if the request failed —
      // the next fetch reconciles. Better UX than blocking on the network.
    }
    set((s) => ({
      items: s.items.map((n) =>
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      ),
      unread: Math.max(0, s.unread - (s.items.find((n) => n.id === id && !n.is_read) ? 1 : 0)),
    }));
  },

  markAllRead: async () => {
    try {
      await api.post("/notifications/read-all");
    } catch {
      return;
    }
    set((s) => ({
      items: s.items.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
      unread: 0,
    }));
  },

  pushIncoming: (envelope) => {
    set((s) => ({
      unread: s.unread + 1,
      // Bump the unread count immediately. The next ``fetch()`` will pull the
      // full record (with id+timestamps) so the dropdown stays correct.
      items: envelope.id
        ? [
            {
              id: envelope.id,
              company_id: null,
              user_id: "",
              category: (envelope.category as AppNotification["category"]) ?? "SYSTEM",
              title: envelope.title ?? "Notification",
              body: envelope.body ?? null,
              payload: null,
              is_read: false,
              read_at: null,
              created_at: new Date().toISOString(),
            } as AppNotification,
            ...s.items,
          ].slice(0, 50)
        : s.items,
    }));
  },
}));
