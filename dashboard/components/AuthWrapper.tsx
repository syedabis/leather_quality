"use client";

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  // Standalone frontend execution mode — bypass auth lock & render dashboard immediately
  return <>{children}</>;
}

