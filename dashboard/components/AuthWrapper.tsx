"use client";
import { useUser } from '@clerk/nextjs';
import Unauthorized from './Unauthorized';
import { getDashboardAccess } from '../lib/access';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null; // middleware handles redirect, this is a safety net

  // A signed-in account with no dashboard grant (e.g. a mobile-only account
  // that happened to sign into the dashboard) — every route lives behind this
  // wrapper, so this is the one place that needs to catch it.
  if (!getDashboardAccess(user.publicMetadata).enabled) {
    return <Unauthorized message="Your account doesn't have dashboard access. Contact an administrator to request access." />;
  }

  return <>{children}</>;
}
