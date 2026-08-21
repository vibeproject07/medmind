'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, Search, User, X } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { useDashboardSearch } from '@/contexts/DashboardSearchContext';
import { useNote } from '@/contexts/NoteContext';

interface UserProfile {
  id: number;
  name: string;
  username?: string | null;
  email: string;
  role: 'admin' | 'manager' | 'regular';
  company_id?: number | null;
  company_name?: string | null;
  academic_status?: string | null;
  academic_period?: number | null;
  institution?: string | null;
  teaching_methodology?: string | null;
  created_at: string;
  updated_at: string;
}

export default function Topbar() {
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [userProfile, setUserProfile]           = useState<UserProfile | null>(null);
  const [loading, setLoading]                   = useState(false);
  const [mobileInitials, setMobileInitials]     = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const { toggleMobile } = useSidebar();
  const pathname = usePathname();
  const { searchQuery, setSearchQuery } = useDashboardSearch();
  const { noteTitle } = useNote();

  // Decode JWT on mount to show initials immediately in mobile header
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.name) {
        const parts = (payload.name as string).trim().split(' ');
        setMobileInitials(
          parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : (payload.name as string).substring(0, 2).toUpperCase()
        );
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node))
        setShowProfileModal(false);
    };
    if (showProfileModal) {
      document.addEventListener('mousedown', handleClickOutside);
      fetchUserProfile();
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProfileModal]);

  const fetchUserProfile = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch('/api/users/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) setUserProfile(await response.json());
    } catch (error) {
      console.error('Erro ao buscar perfil do usuário:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':   return 'Administrador';
      case 'manager': return 'Gerente';
      case 'regular': return 'Usuário Regular';
      default:        return role;
    }
  };

  const getAcademicStatusLabel = (status: string | null | undefined) => {
    if (!status) return null;
    switch (status) {
      case 'student':    return 'Estudante graduando em medicina';
      case 'generalist': return 'Médico Generalista';
      case 'resident':   return 'Médico Residente';
      case 'specialist': return 'Médico Especialista';
      case 'graduate':   return 'Médico mestrando/doutorando';
      default:           return status;
    }
  };

  const getTeachingMethodologyLabel = (methodology: string | null | undefined) => {
    if (!methodology) return null;
    switch (methodology) {
      case 'traditional': return 'Tradicional';
      case 'pbl':         return 'PBL (Project Based Learning)';
      case 'mixed':       return 'Mista';
      case 'other':       return 'Outra';
      default:            return methodology;
    }
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const isNoteDetail = !!(
    pathname?.startsWith('/dashboard/notes/') &&
    pathname.split('/')[3] &&
    pathname.split('/')[3] !== 'new'
  );

  const pageTitle = useMemo(() => {
    if (!pathname) return 'MedMind';
    if (pathname === '/dashboard')                       return 'Dashboard';
    if (isNoteDetail && noteTitle)                       return noteTitle;
    if (pathname.startsWith('/dashboard/notes'))         return 'Biblioteca';
    if (pathname.startsWith('/dashboard/questions'))     return 'Questões';
    if (pathname.startsWith('/dashboard/simulados'))     return 'Simulados';
    if (pathname.startsWith('/dashboard/provas'))        return 'Provas';
    if (pathname.startsWith('/dashboard/settings'))      return 'Configurações';
    if (pathname.startsWith('/dashboard/profile'))       return 'Perfil';
    if (pathname.startsWith('/dashboard/admin'))         return 'Admin';
    return 'MedMind';
  }, [pathname, noteTitle, isNoteDetail]);

  const showSearch =
    pathname?.startsWith('/dashboard/notes') ||
    pathname === '/dashboard/simulados' ||
    pathname === '/dashboard/provas';

  return (
    <>
      {/* ══════════════════════════════════════════
          MOBILE: green contextual topbar
          ══════════════════════════════════════════ */}
      <div className="md:hidden flex items-center bg-primary-600 px-4 h-14 flex-shrink-0 gap-3">
        <button
          onClick={() => setShowProfileModal(true)}
          className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 hover:bg-white/30 transition"
          aria-label="Ver perfil"
        >
          {mobileInitials ? (
            <span className="text-white font-bold text-xs">{mobileInitials}</span>
          ) : (
            <User className="w-4 h-4 text-white" />
          )}
        </button>

        <h1 className="flex-1 text-center font-bold text-base text-white tracking-tight">
          {pageTitle}
        </h1>

        <button
          className="relative w-9 h-9 flex items-center justify-center flex-shrink-0 text-white hover:bg-white/20 rounded-full transition"
          aria-label="Notificações"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-400 rounded-full" />
        </button>
      </div>

      {/* ══════════════════════════════════════════
          DESKTOP: classic white topbar
          ══════════════════════════════════════════ */}
      <div className="hidden md:flex bg-white border-b border-gray-200 px-6 py-4 items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {showSearch && (
            <div className="flex-1 max-w-md min-w-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-base"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <button
            className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Notificações"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>
          <button
            onClick={() => setShowProfileModal(true)}
            className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center hover:bg-primary-200 transition cursor-pointer flex-shrink-0 min-h-[44px] min-w-[44px]"
            aria-label="Ver perfil"
          >
            {userProfile ? (
              <span className="text-primary-700 font-semibold text-sm">{getInitials(userProfile.name)}</span>
            ) : (
              <User className="w-5 h-5 text-primary-600" />
            )}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PROFILE MODAL (shared)
          ══════════════════════════════════════════ */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div ref={modalRef} className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-800">Perfil do Usuário</h2>
              <button
                onClick={() => setShowProfileModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                  <p className="text-gray-600 mt-2">Carregando informações...</p>
                </div>
              ) : userProfile ? (
                <div className="space-y-6">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mb-3">
                      <span className="text-primary-700 font-bold text-2xl">{getInitials(userProfile.name)}</span>
                    </div>
                    <h3 className="text-2xl font-bold text-gray-800">{userProfile.name}</h3>
                    {userProfile.username && (
                      <p className="text-gray-500 text-sm mt-1">@{userProfile.username}</p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</label>
                      <p className="text-gray-800 mt-1">{userProfile.email}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Função</label>
                      <p className="text-gray-800 mt-1">{getRoleLabel(userProfile.role)}</p>
                    </div>
                    {userProfile.company_name && (
                      <div className="bg-gray-50 rounded-lg p-4">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Empresa</label>
                        <p className="text-gray-800 mt-1">{userProfile.company_name}</p>
                      </div>
                    )}
                    {getAcademicStatusLabel(userProfile.academic_status) && (
                      <div className="bg-gray-50 rounded-lg p-4">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Situação Profissional</label>
                        <p className="text-gray-800 mt-1">{getAcademicStatusLabel(userProfile.academic_status)}</p>
                        {userProfile.academic_status === 'student' && (
                          <>
                            {userProfile.academic_period && (
                              <div className="mt-2">
                                <p className="text-sm text-gray-600">
                                  <span className="font-medium">Período:</span> {userProfile.academic_period}º Período
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {userProfile.academic_period >= 1 && userProfile.academic_period <= 4 && <span className="text-blue-600">Ciclo Básico</span>}
                                  {userProfile.academic_period >= 5 && userProfile.academic_period <= 8 && <span className="text-green-600">Ciclo Clínico</span>}
                                  {userProfile.academic_period >= 9 && userProfile.academic_period <= 12 && <span className="text-purple-600">Internato</span>}
                                </p>
                              </div>
                            )}
                            {userProfile.institution && (
                              <div className="mt-2">
                                <p className="text-sm text-gray-600"><span className="font-medium">Instituição:</span> {userProfile.institution}</p>
                              </div>
                            )}
                            {getTeachingMethodologyLabel(userProfile.teaching_methodology) && (
                              <div className="mt-2">
                                <p className="text-sm text-gray-600"><span className="font-medium">Metodologia:</span> {getTeachingMethodologyLabel(userProfile.teaching_methodology)}</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data de Cadastro</label>
                      <p className="text-gray-800 mt-1">{formatDate(userProfile.created_at)}</p>
                    </div>
                    {userProfile.updated_at !== userProfile.created_at && (
                      <div className="bg-gray-50 rounded-lg p-4">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Última Atualização</label>
                        <p className="text-gray-800 mt-1">{formatDate(userProfile.updated_at)}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>Erro ao carregar informações do perfil.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
