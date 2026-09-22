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
  // Bumped from 60s: the plant PC's clock isn't NTP-synced and has been
  // observed drifting close to (or past) a full minute, which made session
  // validation fail right at the old tolerance's edge -- a login would
  // succeed against Clerk's own (accurate-time) servers, then immediately
  // fail this container's clock check, bouncing back to /sign-in in a loop.
  // 5 minutes gives real headroom without meaningfully weakening the check.
  // The actual fix is syncing that PC's clock -- this is a buffer against it
  // drifting again before that happens.
  { clockSkewInMs: 300000 },
);

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm)).*)',
    '/(api|trpc)(.*)',
  ],
};
