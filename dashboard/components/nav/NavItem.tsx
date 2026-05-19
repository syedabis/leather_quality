import Link from 'next/link';
import type { IconType } from 'react-icons';

interface NavItemProps {
  href: string;
  icon: IconType;
  label: string;
  active: boolean;
  collapsed: boolean;
}

const NavItem = ({ href, icon: Icon, label, active, collapsed }: NavItemProps) => (
  <Link href={href} className="block">
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 w-full ${
      collapsed ? 'justify-center' : ''
    } ${
      active
        ? 'bg-[#2AAA8A]/10 text-[#2AAA8A] border border-[#2AAA8A]/20'
        : 'text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white border border-transparent'
    }`}>
      <Icon className="flex-shrink-0 w-4 h-4" />
      {!collapsed && <span className="whitespace-nowrap text-sm font-medium">{label}</span>}
    </div>
  </Link>
);

export default NavItem;
