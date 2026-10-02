"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Root() {
  const router = useRouter();

  useEffect(() => {
    const signedIn = localStorage.getItem('standalone_signed_in') === 'true';
    if (signedIn) {
      router.replace('/overview');
    } else {
      router.replace('/sign-in');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
    </div>
  );
}
