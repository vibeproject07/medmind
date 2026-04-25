'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  Settings, 
  LogOut,
  GraduationCap,
  FileText,
  HelpCircle,
  ClipboardList,
  BookOpen,
  X,
  FlaskConical,
  TestTube2,
  Cpu,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';

type UserRole = 'admin' | 'manager' | 'regular';

export default function Sidebar() {
  const pathname = usePathname();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserRole(payload.role || 'regular');
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
        setUserRole('regular');
      }
    }
  }, []);

  const handleLogout = async () => {
    localStorage.removeItem('token');
    // Limpar cookie também
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  };

  // Menu base - sempre visível
  const baseMenuItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['admin', 'manager', 'regular'] as UserRole[] },
    { href: '/dashboard/notes', icon: FileText, label: 'Notas', roles: ['admin', 'manager', 'regular'] as UserRole[] },
    { href: '/dashboard/questions', icon: HelpCircle, label: 'Questões', roles: ['admin', 'manager', 'regular'] as UserRole[] },
    { href: '/dashboard/simulados', icon: ClipboardList, label: 'Simulados', roles: ['admin', 'manager', 'regular'] as UserRole[] },
    { href: '/dashboard/provas', icon: BookOpen, label: 'Provas', roles: ['admin', 'manager', 'regular'] as UserRole[] },
  ];

  // Menu de admin/manager - apenas para admin e manager
  const adminMenuItems = [
    { href: '/dashboard/users', icon: Users, label: 'Usuários', roles: ['admin', 'manager'] as UserRole[] },
    { href: '/dashboard/settings', icon: Settings, label: 'Configurações', roles: ['admin', 'manager'] as UserRole[] },
    { href: '/dashboard/agentes-editor', icon: FlaskConical, label: 'Editor de Agentes', roles: ['admin'] as UserRole[] },
    { href: '/dashboard/admin/vectorization', icon: Cpu, label: 'Vetorização', roles: ['admin'] as UserRole[] },
    { href: '/dashboard/admin/decs-test', icon: TestTube2, label: 'Teste DeCS A/B', roles: ['admin'] as UserRole[] },
  ];

  // Filtrar menu items baseado no role do usuário
  const getMenuItems = () => {
    if (!userRole) {
      return baseMenuItems; // Enquanto carrega, mostra apenas dashboard
    }

    const allItems = [...baseMenuItems, ...adminMenuItems];
    return allItems.filter(item => item.roles.includes(userRole));
  };

  const menuItems = getMenuItems();
  const closeSidebar = () => setMobileOpen(false);

  return (
    <>
      {/* Overlay quando sidebar aberta */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      {/* Sidebar sobreposta à página */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-gray-900 text-white min-h-screen flex flex-col transition-transform duration-300 ease-out w-64 max-w-[85vw] shadow-xl ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <GraduationCap className="w-8 h-8 text-primary-400 flex-shrink-0" />
            <span className="text-xl font-bold truncate">MedMind</span>
          </div>
          <button
            onClick={closeSidebar}
            className="p-2 rounded-lg hover:bg-gray-800 transition text-gray-300 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Fechar menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeSidebar}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition min-h-[44px] ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white w-full transition min-h-[44px]"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span>Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
}

