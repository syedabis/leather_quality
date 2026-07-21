import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getDashboardAccess } from './lib/access';

const isPublicRoute = createRouteMatcher([
  '/welcome(.*)',
  '/sign-in(.*)',
]);

const isAdminRoute = createRouteMatcher([
  '/monitoring(.*)',
  '/users(.*)',
]);

export default clerkMiddleware(
  async (auth, req) => {
    // Read the session and redirect locally. Do NOT use auth.protect() here:
    // protect() triggers Clerk's handshake, which redirects the request out to
    // Clerk's servers and back on every unauthenticated hit. That is an internet
    // round-trip on the critical path of a page load, and on the plant's network
    // it added tens of seconds to startup. Reading the session and issuing our own
    // redirect is equivalent for this app and stays entirely on-box.
    //
    // Do NOT pass publishableKey/secretKey in the options below either — supplying
    // secretKey puts Clerk into dynamic-key-propagation mode, which then demands
    // CLERK_ENCRYPTION_KEY and 500s without it. Clerk reads both from the env itself.
    const { userId, sessionClaims } = await auth();

    // Signed-in users have no business on the auth pages.
    if (userId && isPublicRoute(req)) {
      return NextResponse.redirect(new URL('/overview', req.url));
    }

    // Signed-out users get bounced off everything else.
    if (!userId && !isPublicRoute(req)) {
      return NextResponse.redirect(new URL('/sign-in', req.url));
    }

    // Admin-only routes — non-admins land on /overview.
    if (userId && isAdminRoute(req) && getDashboardAccess(sessionClaims?.metadata).role !== 'admin') {
      return NextResponse.redirect(new URL('/overview', req.url));
    }
  },
  { clockSkewInMs: 60000 },
);

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
