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

      if (userId && isPublicRoute(req)) {
        return NextResponse.redirect(new URL('/overview', req.url));
      }

      if (!userId && !isPublicRoute(req)) {
        return NextResponse.redirect(new URL('/sign-in', req.url));
      }
    } catch {
      if (!isPublicRoute(req)) {
        return NextResponse.redirect(new URL('/sign-in', req.url));
      }
    }
  },
  { publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY },
);

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
