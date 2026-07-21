import { auth } from '@clerk/nextjs/server';
import { getDashboardAccess } from '../lib/access';

/**
 * checkRole — server-side role check using JWT session claims.
 * Fast: no clerkClient network call needed.
 *
 * NOTE: Clerk maps publicMetadata → sessionClaims.metadata in the JWT.
 * Access via getDashboardAccess(sessionClaims.metadata) (NOT sessionClaims.publicMetadata.role).
 */
export async function checkRole(role: string): Promise<boolean> {
  const { sessionClaims } = await auth();
  const access = getDashboardAccess(sessionClaims?.metadata);
  return access.enabled && access.role === role;
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
