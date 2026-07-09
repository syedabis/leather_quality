import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

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
    // Public routes: pass through immediately, no auth check.
    if (isPublicRoute(req)) {
      return NextResponse.next();
    }

    // auth.protect() is Clerk v7's canonical method for protecting routes.
    // It handles the dev-mode handshake (__clerk_db_jwt / __clerk_CH) correctly
    // and redirects to sign-in automatically if the user is not authenticated.
    await auth.protect();

    // Admin-only routes
    if (isAdminRoute(req)) {
      const { sessionClaims } = await auth();
      if (sessionClaims?.metadata?.role !== 'admin') {
        return NextResponse.redirect(new URL('/overview', req.url));
      }
    }
  },
  {
    signInUrl: '/sign-in',
    clockSkewInMs: 60000,
  },
);

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
