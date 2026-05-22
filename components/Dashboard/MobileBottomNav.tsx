'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  HelpCircle,
  ClipboardList,
  BookOpen,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard',             icon: LayoutDashboard, label: 'Início'    },
  { href: '/dashboard/notes',       icon: FileText,        label: 'Notas'     },
  { href: '/dashboard/questions',   icon: HelpCircle,      label: 'Questões'  },
  { href: '/dashboard/simulados',   icon: ClipboardList,   label: 'Simulados' },
  { href: '/dashboard/provas',      icon: BookOpen,        label: 'Provas'    },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden flex-shrink-0 flex items-center justify-around h-[68px] px-2">
      {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
        const isActive =
          href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname?.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1 flex-1 py-1"
          >
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                isActive ? 'bg-primary-500' : 'bg-white/10'
              }`}
            >
              <Icon
                className={`w-5 h-5 ${
                  isActive ? 'text-white' : 'text-gray-400'
                }`}
              />
            </div>
            <span
              className={`text-[10px] font-medium leading-none ${
                isActive ? 'text-white' : 'text-gray-500'
              }`}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
