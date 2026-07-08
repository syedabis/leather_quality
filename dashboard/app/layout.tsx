import type { Metadata } from 'next';
import "./globals.css";
import { ClerkProvider } from '@clerk/nextjs';
import ClientLayout from '../components/ClientLayout';
import { ThemeProvider } from '../components/ThemeProvider';
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: 'Spray Plant Monitor',
  description: 'Dada Leather — spray plant automation dashboard',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      dynamic
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      afterSignOutUrl="/sign-in"
    >
      <html lang="en" className={cn("font-sans")} suppressHydrationWarning>
        <body className="antialiased">
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            <ClientLayout>
              {children}
            </ClientLayout>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
