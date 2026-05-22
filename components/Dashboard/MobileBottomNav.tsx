'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  HelpCircle,
  ClipboardList,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import { useNote } from '@/contexts/NoteContext';

const NAV_ITEMS = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Início'    },
  { href: '/dashboard/notes',     icon: FileText,        label: 'Notas'     },
  { href: '/dashboard/questions', icon: HelpCircle,      label: 'Questões'  },
  { href: '/dashboard/simulados', icon: ClipboardList,   label: 'Simulados' },
  { href: '/dashboard/provas',    icon: BookOpen,        label: 'Provas'    },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { notePanel, setNotePanel } = useNote();

  const isNoteDetail = !!(
    pathname?.startsWith('/dashboard/notes/') &&
    pathname.split('/')[3] &&
    pathname.split('/')[3] !== 'new'
  );

  return (
    <nav
      className="md:hidden flex-shrink-0 overflow-hidden"
      style={{
        height: '92px',
        boxShadow: isNoteDetail ? 'inset 0 -7px 0 #10b981' : 'none',
        transition: 'box-shadow 0.3s ease',
      }}
    >
      {/* Two-panel carousel — slides left when on a note detail page */}
      <div
        className="flex h-full"
        style={{
          width: '200%',
          transform: isNoteDetail ? 'translateX(-50%)' : 'translateX(0)',
          transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* ── Panel 1: Primary navigation ───────────────────────────── */}
        <div className="flex items-center justify-around px-2 pb-2" style={{ width: '50%' }}>
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const isActive =
              href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname?.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-1.5 flex-1 py-2"
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                    isActive ? 'bg-primary-500' : 'bg-white/10'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                </div>
                <span className={`text-[10px] font-medium leading-none ${isActive ? 'text-white' : 'text-gray-500'}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>

        {/* ── Panel 2: Note context (Fontes | Nota | Estúdio) ───────── */}
        <div
          className="flex items-center justify-around px-4 pb-2"
          style={{ width: '50%' }}
        >
          {/* Fontes */}
          <button
            type="button"
            onClick={() => setNotePanel(notePanel === 'fontes' ? null : 'fontes')}
            className="flex flex-col items-center gap-1.5 flex-1 py-2"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                notePanel === 'fontes' ? 'bg-primary-500' : 'bg-white/10'
              }`}
            >
              <BookOpen className={`w-5 h-5 ${notePanel === 'fontes' ? 'text-white' : 'text-white/60'}`} />
            </div>
            <span className={`text-[10px] font-medium leading-none ${notePanel === 'fontes' ? 'text-white' : 'text-white/60'}`}>
              Fontes
            </span>
          </button>

          {/* Nota — center, larger, always prominent */}
          <button
            type="button"
            onClick={() => setNotePanel(null)}
            className="flex flex-col items-center gap-1.5 flex-1 py-1"
          >
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                notePanel === null ? 'bg-primary-500' : 'bg-white/10'
              }`}
            >
              <FileText className={`w-6 h-6 ${notePanel === null ? 'text-white' : 'text-white/60'}`} />
            </div>
            <span className={`text-[10px] font-semibold leading-none ${notePanel === null ? 'text-white' : 'text-white/60'}`}>
              Nota
            </span>
          </button>

          {/* Estúdio */}
          <button
            type="button"
            onClick={() => setNotePanel(notePanel === 'estudio' ? null : 'estudio')}
            className="flex flex-col items-center gap-1.5 flex-1 py-2"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                notePanel === 'estudio' ? 'bg-primary-500' : 'bg-white/10'
              }`}
            >
              <Sparkles className={`w-5 h-5 ${notePanel === 'estudio' ? 'text-white' : 'text-white/60'}`} />
            </div>
            <span className={`text-[10px] font-medium leading-none ${notePanel === 'estudio' ? 'text-white' : 'text-white/60'}`}>
              Estúdio
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
}
