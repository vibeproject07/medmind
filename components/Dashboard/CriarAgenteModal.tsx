'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';

const FUNCIONALIDADE_OPCOES = [
  'Resumo de documentos',
  'Transcrição',
  'Perguntas e respostas',
  'Análise de texto',
  'Geração de conteúdo',
  'Extração de informações',
  'Classificação',
  'Outro',
];

export interface CriarAgenteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: { nome: string; funcionalidade: string[]; fluxo: string }) => void;
}

export default function CriarAgenteModal({ isOpen, onClose, onSubmit }: CriarAgenteModalProps) {
  const [nome, setNome] = useState('');
  const [funcionalidade, setFuncionalidade] = useState<string[]>([]);
  const [fluxo, setFluxo] = useState('');

  const handleClose = () => {
    setNome('');
    setFuncionalidade([]);
    setFluxo('');
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.({ nome, funcionalidade, fluxo });
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">Criar Agente</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 space-y-4 overflow-y-auto">
            <div>
              <label htmlFor="criar-agente-nome" className="block text-sm font-medium text-gray-700 mb-2">
                Nome do Agente
              </label>
              <input
                type="text"
                id="criar-agente-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Agente de resumo de PDFs"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <TagAutocomplete
                label="Funcionalidade"
                options={FUNCIONALIDADE_OPCOES}
                selectedTags={funcionalidade}
                onChange={setFuncionalidade}
                placeholder="Selecione ou digite a funcionalidade"
                maxTags={5}
              />
            </div>

            <div>
              <label htmlFor="criar-agente-fluxo" className="block text-sm font-medium text-gray-700 mb-2">
                Fluxo do Agente
              </label>
              <textarea
                id="criar-agente-fluxo"
                value={fluxo}
                onChange={(e) => setFluxo(e.target.value)}
                placeholder="Descreva o fluxo ou etapas do agente..."
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
              />
            </div>
          </div>

          <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium"
            >
              Criar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
