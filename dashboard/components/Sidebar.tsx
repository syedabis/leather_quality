"use client";
import { usePathname, useRouter } from 'next/navigation';
import { useUser, useClerk } from '@clerk/nextjs';
import { FaBars, FaTimes } from 'react-icons/fa';
import {
  FiGrid, FiMap, FiLayers, FiVideo, FiList,
  FiFileText, FiSettings, FiLogOut, FiUsers, FiBell, FiHelpCircle,
} from 'react-icons/fi';
import NavItem from './nav/NavItem';
import type { IconType } from 'react-icons';
import { getDashboardAccess } from '../lib/access';

interface NavEntry {
  href: string;
  icon: IconType;
  label: string;
  adminOnly?: boolean;
}

const NAV: NavEntry[] = [
  { href: '/overview',   icon: FiGrid,     label: 'Overview'    },
  { href: '/floor-view', icon: FiMap,      label: 'Floor View'  },
  { href: '/piece-view', icon: FiLayers,   label: 'Piece View'  },
  { href: '/monitoring', icon: FiVideo,    label: 'Monitoring', adminOnly: true },
  { href: '/sessions',   icon: FiList,      label: 'Sessions'   },
  { href: '/reports',    icon: FiFileText,  label: 'Reports'    },
  { href: '/notifications', icon: FiBell,   label: 'Notifications' },
  { href: '/users',      icon: FiUsers,     label: 'Users',     adminOnly: true },
];

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const Sidebar = ({ collapsed, setCollapsed }: SidebarProps) => {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName[0]}.` : ''}`
    : user?.primaryEmailAddress?.emailAddress?.split('@')[0] ?? '…';

  const role = getDashboardAccess(user?.publicMetadata).role ?? undefined;

  return (
    <div className={`fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground flex flex-col
      transition-all duration-300 ease-in-out z-50 border-r border-sidebar-border
      ${collapsed ? 'w-18' : 'w-58'} px-1 py-4`}>

      {/* Logo + toggle */}
      <div className="flex items-center justify-between py-2 px-3 mb-2">
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-widest text-[#2AAA8A] uppercase">
              Dada Enterprises
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-600 tracking-wide">Dada Leather</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 hover:bg-[#2AAA8A]/10 rounded-lg transition-colors duration-200 ml-auto"
        >
          {collapsed
            ? <FaBars className="text-gray-500 dark:text-gray-400 w-3.5 h-3.5" />
            : <FaTimes className="text-gray-500 dark:text-gray-400 w-3.5 h-3.5" />
          }
        </button>
      </div>

      {/* Divider */}
      <div className="h-px bg-sidebar-border mx-3 mb-3" />

      {/* Main nav */}
      <nav className="flex-1 flex flex-col gap-0.5">
        {NAV.filter(item => !item.adminOnly || role === 'admin').map(item => (
          <NavItem
            key={item.href}
            {...item}
            active={pathname === item.href || pathname.startsWith(item.href + '/')}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* User info + sign out */}
      <div className="border-t border-sidebar-border pt-3 mt-3 flex flex-col gap-0.5">
        <NavItem
          href="/help"
          icon={FiHelpCircle}
          label="Help"
          active={pathname === '/help'}
          collapsed={collapsed}
        />

        <NavItem
          href="/settings"
          icon={FiSettings}
          label="Settings"
          active={pathname === '/settings'}
          collapsed={collapsed}
        />

        {/* User avatar row — click to go to /settings */}
        {isLoaded && user && (
          <button
            onClick={() => router.push('/settings')}
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg w-full
              hover:bg-[#2AAA8A]/10 transition-colors text-left
              ${pathname === '/settings' ? 'bg-[#2AAA8A]/10' : ''}
              ${collapsed ? 'justify-center' : ''}`}
          >
            <div className="w-7 h-7 rounded-full bg-[#2AAA8A]/20 border border-[#2AAA8A]/30
              flex items-center justify-center flex-shrink-0 overflow-hidden">
              {user.imageUrl ? (
                <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] font-bold text-[#2AAA8A] uppercase">
                  {(user.firstName?.[0] ?? user.primaryEmailAddress?.emailAddress?.[0] ?? '?')}
                </span>
              )}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{displayName}</p>
                {role && (
                  <p className="text-[10px] text-[#2AAA8A] capitalize">{role}</p>
                )}
              </div>
            )}
          </button>
        )}

        {/* Sign out button */}
        <button
          onClick={() => signOut({ redirectUrl: '/sign-in' })}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200
            text-gray-500 dark:text-gray-400 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 border border-transparent
            hover:border-red-500/20 ${collapsed ? 'justify-center' : ''}`}
        >
          <FiLogOut className="flex-shrink-0 w-4 h-4" />
          {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
