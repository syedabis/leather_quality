"use client";
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Toaster } from 'sonner';
import Sidebar from './Sidebar';
import AuthWrapper from './AuthWrapper';
import { Header } from './Header';
import { SidebarContext } from '../contexts/SidebarContext';
import { NotificationsProvider } from '../contexts/NotificationsContext';

const NO_SIDEBAR_ROUTES = ['/sign-in', '/welcome', '/login'];

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showSidebar = !NO_SIDEBAR_ROUTES.some(r => pathname.startsWith(r));
  const [collapsed, setCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const hideSidebar = !showSidebar || isFullscreen;

  const content = (
    <SidebarContext.Provider value={{ collapsed, hidden: hideSidebar }}>
    <div className="flex">
      {!hideSidebar && <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />}
      <div className={`transition-all duration-300 min-h-screen bg-background flex-1 flex flex-col ${
        !hideSidebar ? (collapsed ? 'ml-18' : 'ml-58') : ''
      }`}>
        {showSidebar && <Header />}
        {children}
      </div>
    </div>
    </SidebarContext.Provider>
  );

  // Wrap dashboard routes in RBAC gate; leave auth/public pages unwrapped.
  // NotificationsProvider drives the live toast + bell; Toaster renders them.
  if (showSidebar) {
    return (
      <AuthWrapper>
        <NotificationsProvider>
          {content}
          <Toaster position="top-right" richColors closeButton />
        </NotificationsProvider>
      </AuthWrapper>
    );
  }

  return content;
}
