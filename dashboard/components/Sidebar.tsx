"use client";
import { usePathname, useRouter } from 'next/navigation';
import { useUser, useClerk } from '../lib/mockAuth';
import { FaBars, FaTimes } from 'react-icons/fa';
import {
  FiSettings, FiLogOut, FiHelpCircle,
} from 'react-icons/fi';
import NavItem from './nav/NavItem';
import { getDashboardAccess } from '../lib/access';
import { useProject, SYSTEM_ROUTES } from '../contexts/ProjectContext';

interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const Sidebar = ({ collapsed, setCollapsed }: SidebarProps) => {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { projectMeta } = useProject();

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName[0]}.` : ''}`
    : user?.primaryEmailAddress?.emailAddress?.split('@')[0] ?? 'Operator Admin';

  const role = getDashboardAccess(user?.publicMetadata).role ?? 'admin';

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

      {/* Main nav */}
      <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden pr-0.5">
        {/* Active Project Section Header */}
        {!collapsed && (
          <div className="px-3 pt-1 pb-1 text-[10px] font-bold tracking-wider uppercase text-gray-400 dark:text-gray-500 flex items-center justify-between">
            <span>{projectMeta.name}</span>
            <span className="text-[9px] lowercase font-normal px-1 rounded bg-black/5 dark:bg-white/5">
              workspace
            </span>
          </div>
        )}

        {/* Project Specific Routes */}
        {projectMeta.routes
          .filter(item => !item.adminOnly || role === 'admin')
          .map(item => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname === item.href || (pathname.startsWith(item.href + '/') && item.href !== '/')}
              collapsed={collapsed}
            />
          ))}

        {/* Divider before system links */}
        <div className="h-px bg-sidebar-border mx-3 my-2" />

        {/* System & Audit Section */}
        {!collapsed && (
          <div className="px-3 pb-1 text-[10px] font-bold tracking-wider uppercase text-gray-400 dark:text-gray-500">
            Operations & System
          </div>
        )}

        {SYSTEM_ROUTES
          .filter(item => !item.adminOnly || role === 'admin')
          .map(item => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname === item.href || (pathname.startsWith(item.href + '/') && item.href !== '/')}
              collapsed={collapsed}
            />
          ))}
      </nav>

      {/* User info + sign out */}
      <div className="border-t border-sidebar-border pt-3 mt-2 flex flex-col gap-0.5">
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
        <button
          onClick={() => router.push('/settings')}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg w-full
            hover:bg-[#2AAA8A]/10 transition-colors text-left
            ${pathname === '/settings' ? 'bg-[#2AAA8A]/10' : ''}
            ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="w-7 h-7 rounded-full bg-[#2AAA8A]/20 border border-[#2AAA8A]/30
            flex items-center justify-center flex-shrink-0 overflow-hidden">
            {user?.imageUrl ? (
              <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[10px] font-bold text-[#2AAA8A] uppercase">
                D
              </span>
            )}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{displayName}</p>
              <p className="text-[10px] text-[#2AAA8A] capitalize">{role}</p>
            </div>
          )}
        </button>

        {/* Sign out button */}
        <button
          onClick={() => {
            try { signOut(); } catch { localStorage.setItem('standalone_signed_in', 'false'); window.location.href = '/sign-in'; }
          }}
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
