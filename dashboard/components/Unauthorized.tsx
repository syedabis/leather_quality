"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { motion } from 'framer-motion';
import { FiLock } from 'react-icons/fi';

export default function Unauthorized() {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user, isLoaded } = useUser();

  // If role was just granted, redirect in
  useEffect(() => {
    if (isLoaded && user?.publicMetadata?.role === 'admin') {
      router.push('/overview');
    }
  }, [user, isLoaded, router]);

  if (!isLoaded || user?.publicMetadata?.role === 'admin') {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2AAA8A]/30 border-t-[#2AAA8A] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center max-w-sm px-4"
      >
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <FiLock className="w-6 h-6 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2 font-[family-name:var(--font-inter-tight)]">
          Access Denied
        </h1>
        <p className="text-gray-500 text-sm mb-8">
          Your account doesn&apos;t have permission to access this dashboard. Contact an administrator to request access.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
            className="w-full bg-[#2AAA8A] text-white py-2.5 rounded-xl font-semibold text-sm
              hover:bg-[#2AAA8A]/90 transition-colors"
          >
            Sign Out
          </button>
          <a
            href="/sign-in"
            className="w-full text-center text-sm text-gray-600 hover:text-gray-400 transition-colors py-2"
          >
            Sign in with a different account
          </a>
        </div>
      </motion.div>
    </div>
  );
}
