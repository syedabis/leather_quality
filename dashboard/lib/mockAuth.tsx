"use client";
import React, { useState, useEffect } from 'react';

/**
 * Lightweight Standalone Auth Mock (.tsx)
 * Replaces @clerk/nextjs hooks in standalone mode without network dependencies or reload loops.
 */

export const MOCK_ADMIN_USER = {
  id: 'usr_standalone_admin',
  email: process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL ?? 'admin@dada.com',
  password: process.env.NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD ?? 'Leanwaste123@0',
  firstName: 'Operator',
  lastName: 'Admin',
};

export function useUser() {
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    const authState = localStorage.getItem('standalone_signed_in');
    if (authState === 'false') {
      setSignedIn(false);
    } else {
      setSignedIn(true);
    }
  }, []);

  return {
    user: signedIn ? {
      id: MOCK_ADMIN_USER.id,
      firstName: MOCK_ADMIN_USER.firstName,
      lastName: MOCK_ADMIN_USER.lastName,
      primaryEmailAddress: { emailAddress: MOCK_ADMIN_USER.email },
      publicMetadata: { role: 'admin' as const, enabled: true },
      imageUrl: null as string | null,
      update: async (data: any) => data,
      setProfileImage: async (data: any) => data,
    } : null,
    isLoaded: true,
    isSignedIn: signedIn,
  };
}

export function useClerk() {
  return {
    signOut: async () => {
      localStorage.setItem('standalone_signed_in', 'false');
      window.location.href = '/sign-in';
    },
    setActive: async ({ session }: { session: string }) => {
      localStorage.setItem('standalone_signed_in', 'true');
      return session;
    }
  };
}

export function useAuth() {
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    const authState = localStorage.getItem('standalone_signed_in');
    if (authState === 'false') {
      setSignedIn(false);
    } else {
      setSignedIn(true);
    }
  }, []);

  return {
    getToken: async () => 'standalone-mock-token',
    userId: signedIn ? MOCK_ADMIN_USER.id : null,
    isLoaded: true,
    isSignedIn: signedIn,
  };
}

export function useSignIn() {
  return {
    isLoaded: true,
    signIn: {
      status: 'complete',
      createdSessionId: 'sess_standalone_admin',
      create: async ({ identifier, password }: { identifier?: string; password?: string }) => {
        localStorage.setItem('standalone_signed_in', 'true');
        return {
          status: 'complete',
          createdSessionId: 'sess_standalone_admin',
        };
      },
      attemptSecondFactor: async () => {
        localStorage.setItem('standalone_signed_in', 'true');
        return {
          status: 'complete',
          createdSessionId: 'sess_standalone_admin',
        };
      }
    }
  };
}

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return <React.Fragment>{children}</React.Fragment>;
}
