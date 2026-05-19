import { auth } from '@clerk/nextjs/server';

/**
 * checkRole — server-side role check using JWT session claims.
 * Fast: no clerkClient network call needed.
 *
 * NOTE: Clerk maps publicMetadata → sessionClaims.metadata in the JWT.
 * Access via sessionClaims.metadata.role (NOT sessionClaims.publicMetadata.role).
 */
export async function checkRole(role: string): Promise<boolean> {
  const { sessionClaims } = await auth();
  return sessionClaims?.metadata?.role === role;
}

/**
 * requireRole — throws a redirect if role doesn't match.
 * Use in Server Components / Route Handlers.
 */
export async function requireRole(role: string): Promise<void> {
  const hasRole = await checkRole(role);
  if (!hasRole) {
    const { redirect } = await import('next/navigation');
    redirect('/overview');
  }
}

// Role constants live in lib/constants.ts (safe for client + server).
// Re-exported here for convenience in server-only utilities.
export { ROLES } from '../lib/constants';
