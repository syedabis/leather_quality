"use client";

import Link from "next/link";
import { FiBell } from "react-icons/fi";
import { ThemeToggle } from "./ThemeToggle";
import { FullscreenToggle } from "./FullscreenToggle";
import { useNotifications } from "../contexts/NotificationsContext";

export function Header() {
  const { unread } = useNotifications();

  return (
    <header className="sticky top-0 z-40 h-12 flex items-center justify-end
      px-5 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Link
          href="/notifications"
          aria-label="Notifications"
          className="relative p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <FiBell className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full
              bg-red-500 text-white text-[10px] font-bold leading-4 text-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        <FullscreenToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
