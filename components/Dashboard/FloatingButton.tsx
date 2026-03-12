'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import CriarNotaModal from '@/components/Dashboard/CriarNotaModal';

export default function FloatingButton() {
  const pathname = usePathname();
  const [showCriarNotaModal, setShowCriarNotaModal] = useState(false);

  if (pathname === '/dashboard/notes/new') {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setShowCriarNotaModal(true)}
        className="fixed bottom-6 right-6 sm:bottom-6 sm:right-6 bg-primary-600 text-white w-14 h-14 min-h-[56px] min-w-[56px] rounded-full shadow-lg hover:bg-primary-700 transition-all hover:scale-110 active:scale-95 flex items-center justify-center z-50 [bottom:max(1.5rem,env(safe-area-inset-bottom))] [right:max(1.5rem,env(safe-area-inset-right))]"
        aria-label="Criar nova nota"
      >
        <Plus className="w-6 h-6" />
      </button>
      <CriarNotaModal
        isOpen={showCriarNotaModal}
        onClose={() => setShowCriarNotaModal(false)}
      />
    </>
  );
}
