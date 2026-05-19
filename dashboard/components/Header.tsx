"use client";

import { ThemeToggle } from "./ThemeToggle";
import { FullscreenToggle } from "./FullscreenToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-40 h-12 flex items-center justify-end
      px-5 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <FullscreenToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
