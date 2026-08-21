'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { stagePendingNoteSources } from '@/lib/pending-note-sources';

export const PENDING_TRANSFORM_FILES_KEY = 'pendingTransformFiles';

export interface CriarNotaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CriarNotaModal({ isOpen, onClose }: CriarNotaModalProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleEscreverNota = () => {
    onClose();
    router.push('/dashboard/notes/new?tab=conteudo');
  };

  const openFilePicker = (accept: string) => {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = accept;
    fileInputRef.current.click();
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    stagePendingNoteSources(files);
    onClose();
    router.push('/dashboard/notes/new?tab=conteudo');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">Criar arquivo</h2>
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
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFiles} />
          <p className="text-lg text-gray-800">
            Como deseja iniciar seu arquivo?
          </p>
          <div className="flex flex-col gap-3 w-full">
            <button
              type="button"
              onClick={handleEscreverNota}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Escrever arquivo
            </button>
            <button
              type="button"
              onClick={() => openFilePicker('video/*')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Vídeos
            </button>
            <button
              type="button"
              onClick={() => openFilePicker('audio/*')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Áudios
            </button>
            <button
              type="button"
              onClick={() => openFilePicker('image/*')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Imagens
            </button>
            <button
              type="button"
              onClick={() => openFilePicker('.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/html')}
              className="w-full px-4 py-3 bg-primary-600 text-white border border-primary-600 rounded-lg hover:bg-primary-700 hover:border-primary-700 transition font-medium text-center"
            >
              Outros arquivos
            </button>
          </div>
          <p className="text-base text-gray-800">
            Selecione uma fonte para visualizá-la, escrever o arquivo e completar suas informações antes de salvar.
          </p>
        </div>
      </div>
    </div>
  );
}
