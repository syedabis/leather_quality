"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Render a stable placeholder before mount to avoid hydration mismatch
  if (!mounted) {
    return (
      <div className="w-8 h-8 rounded-lg border border-border" />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`relative flex items-center justify-center w-8 h-8 rounded-lg border border-border
        bg-background text-foreground
        hover:bg-muted transition-colors duration-200 ${className ?? ""}`}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Sun
        size={15}
        className={`absolute transition-all duration-200 ${isDark ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}
      />
      <Moon
        size={15}
        className={`absolute transition-all duration-200 ${isDark ? "opacity-0 scale-75" : "opacity-100 scale-100"}`}
      />
    </button>
  );
}
