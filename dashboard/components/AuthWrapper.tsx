"use client";

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/mockAuth';

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !isLoaded) return;

    const isPublicRoute = pathname === '/sign-in' || pathname.startsWith('/sign-in/');
    if (!isSignedIn && !isPublicRoute) {
      router.replace('/sign-in');
    }
  }, [isSignedIn, isLoaded, pathname, router, mounted]);

  if (pathname === '/sign-in' || pathname.startsWith('/sign-in/')) {
    return <>{children}</>;
  }

  if (!mounted || !isLoaded) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  return <>{children}</>;
}
