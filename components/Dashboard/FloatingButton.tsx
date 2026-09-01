'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export default function FloatingButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (
    pathname === '/dashboard/notes/new' ||
    pathname.startsWith('/dashboard/simulados/novo') ||
    pathname.startsWith('/dashboard/provas/')
  ) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => router.push('/dashboard/notes/new?tab=fontes')}
        className="hidden md:flex fixed bottom-6 right-6 bg-primary-600 text-white w-14 h-14 min-h-[56px] min-w-[56px] rounded-full shadow-lg hover:bg-primary-700 transition-all hover:scale-110 active:scale-95 items-center justify-center z-50"
        aria-label="Criar nova nota"
      >
        <Plus className="w-6 h-6" />
      </button>
      {/*
        Fluxo antigo: o botão abria CriarNotaModal, que depois abria
        ResumoAulasModal. A página de nova nota já concentra o processamento
        na aba Fontes, então esse modal não é mais utilizado pelo botão.
      */}
    </>
  );
}
