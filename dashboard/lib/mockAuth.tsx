"use client";
import React from 'react';

/**
 * Lightweight Standalone Auth Mock (.tsx)
 * Replaces @clerk/nextjs hooks in standalone mode without network dependencies or reload loops.
 */

export function useUser() {
  return {
    user: {
      id: 'usr_standalone_admin',
      firstName: 'Operator',
      lastName: 'Admin',
      primaryEmailAddress: { emailAddress: 'admin@dada.com' },
      publicMetadata: { role: 'admin' as const, enabled: true },
      imageUrl: null as string | null,
      update: async (data: any) => data,
      setProfileImage: async (data: any) => data,
    },
    isLoaded: true,
    isSignedIn: true,
  };
}

export function useClerk() {
  return {
    signOut: async () => {
      window.location.href = '/overview';
    },
  };
}

export function useAuth() {
  return {
    getToken: async () => 'standalone-mock-token',
    userId: 'usr_standalone_admin',
    isLoaded: true,
    isSignedIn: true,
  };
}

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return <React.Fragment>{children}</React.Fragment>;
}
