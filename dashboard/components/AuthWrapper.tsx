"use client";
import { useUser } from '@clerk/nextjs';
import Unauthorized from './Unauthorized';

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

  if (user.publicMetadata?.role !== 'admin') {
    return <Unauthorized />;
  }

  return <>{children}</>;
}
