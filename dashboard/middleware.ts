import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/welcome(.*)',
  '/sign-in(.*)',
]);

export default clerkMiddleware(
  async (auth, req) => {
    try {
      const { userId } = await auth();

      // Redirect authenticated users away from auth pages
      if (userId && isPublicRoute(req)) {
        return NextResponse.redirect(new URL('/overview', req.url));
      }

      // Redirect unauthenticated users away from protected pages
      if (!userId && !isPublicRoute(req)) {
        return NextResponse.redirect(new URL('/sign-in', req.url));
      }
    } catch {
      // If Clerk auth check fails (e.g. key unavailable), redirect to sign-in
      // rather than silently falling through to a protected page.
      if (!isPublicRoute(req)) {
        return NextResponse.redirect(new URL('/sign-in', req.url));
      }
    }
  },
  { publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, clockSkewInMs: 30000 },
);

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
