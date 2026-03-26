'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  CheckSquare,
  ShieldCheck,
  BarChart2,
  Users,
  Settings,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/auth-context';
import { UserRole } from '@qa/shared';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: UserRole[];
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Conversations', href: '/conversations', icon: MessageSquare },
  { label: 'QA Queue', href: '/qa-queue', icon: CheckSquare, roles: [UserRole.QA, UserRole.ADMIN] },
  {
    label: 'Verifier Queue',
    href: '/verifier-queue',
    icon: ShieldCheck,
    roles: [UserRole.VERIFIER, UserRole.ADMIN],
    disabled: true,
  },
  { label: 'Forms', href: '/forms', icon: FileText, roles: [UserRole.ADMIN] },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart2,
    roles: [UserRole.ADMIN],
    disabled: true,
  },
  { label: 'Users', href: '/users', icon: Users, roles: [UserRole.ADMIN] },
  { label: 'LLM Settings', href: '/settings/llm', icon: Settings, roles: [UserRole.ADMIN] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const role = user?.role as UserRole;

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-gray-200 px-6">
        <span className="text-lg font-bold text-primary-700">QA Platform</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.disabled ? '#' : item.href}
                  aria-disabled={item.disabled}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    item.disabled && 'pointer-events-none opacity-40',
                  )}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                  {item.disabled && <span className="ml-auto text-xs text-gray-400">Soon</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="border-t border-gray-200 p-3">
        <div className="mb-2 px-3 py-1">
          <p className="truncate text-sm font-medium text-gray-800">{user?.name}</p>
          <p className="truncate text-xs text-gray-500">{user?.email}</p>
          <span className="mt-1 inline-block rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
            {user?.role}
          </span>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
