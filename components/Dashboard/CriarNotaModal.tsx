'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import ResumoAulasModal from '@/components/Dashboard/ResumoAulasModal';
import { saveDraftNote } from '@/lib/safe-local-storage';

export const PENDING_TRANSFORM_FILES_KEY = 'pendingTransformFiles';

export interface CriarNotaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CriarNotaModal({ isOpen, onClose }: CriarNotaModalProps) {
  const router = useRouter();
  const [showResumoModal, setShowResumoModal] = useState(false);
  const [resumoAccept, setResumoAccept] = useState<string>('');

  const saveDraft = (resumoAulas?: { melhorado: string; original: string }) => {
    if (typeof window !== 'undefined') {
      try {
        const existing = localStorage.getItem('draftNote');
        let draft: Record<string, unknown> = {
          title: '',
          description: '',
          informacoes: '',
          tipoConteudo: '',
          tags: [],
          areasConhecimento: [],
          assuntos: [],
          images: [],
        };
        if (existing) {
          draft = { ...draft, ...JSON.parse(existing) };
        }
        if (resumoAulas) {
          draft.resumoAulas = resumoAulas;
        }
        saveDraftNote(draft);
      } catch {
        // Draft persistence is best-effort; it must not block opening a note.
      }
    }
  };

  const handleEscreverNota = () => {
    saveDraft();
    onClose();
    router.push('/dashboard/notes/new?tab=conteudo');
  };

  const openResumoForType = (accept: string) => {
    setResumoAccept(accept);
    setShowResumoModal(true);
  };

  const handleSaveResumoAndRedirect = (melhorado: string, original: string) => {
    saveDraft({ melhorado, original });
    setShowResumoModal(false);
    onClose();
    router.push('/dashboard/notes/new?tab=fontes');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">Criar Nota</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition shrink-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-6 space-y-6 min-h-[320px]">
          <p className="text-lg text-gray-800">
            Como deseja iniciar sua nota?
          </p>
          <div className="flex flex-col gap-3 w-full">
            <button
              type="button"
              onClick={handleEscreverNota}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Escrever Nota
            </button>
            <button
              type="button"
              onClick={() => openResumoForType('video/*')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Vídeos
            </button>
            <button
              type="button"
              onClick={() => openResumoForType('audio/*')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Áudios
            </button>
            <button
              type="button"
              onClick={() => openResumoForType('image/*')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Imagens
            </button>
            <button
              type="button"
              onClick={() => openResumoForType('.pdf,.doc,.docx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/html')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Outros arquivos
            </button>
          </div>
          <p className="text-base text-gray-800">
            Faça upload de um arquivo para que nossos agentes possam criar uma nota para você.
          </p>
        </div>
      </div>

      <ResumoAulasModal
        isOpen={showResumoModal}
        onClose={() => setShowResumoModal(false)}
        title="Transformando Arquivos com IA"
        accept={resumoAccept}
        showContinueToNote
        onSaveResumo={handleSaveResumoAndRedirect}
      />
    </div>
  );
}
