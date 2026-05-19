"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

export function FullscreenToggle({ className }: { className?: string }) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <button
      onClick={toggle}
      className={`relative flex items-center justify-center w-8 h-8 rounded-lg border border-border
        bg-background text-foreground hover:bg-muted transition-colors duration-200 ${className ?? ""}`}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      <Maximize2
        size={15}
        className={`absolute transition-all duration-200 ${isFullscreen ? "opacity-0 scale-75" : "opacity-100 scale-100"}`}
      />
      <Minimize2
        size={15}
        className={`absolute transition-all duration-200 ${isFullscreen ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}
      />
    </button>
  );
}
