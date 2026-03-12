'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import CriarAgenteModal from '@/components/Dashboard/CriarAgenteModal';

export default function AgentesIAPage() {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<{ id: string; name: string; description?: string; createdAt?: string }[]>([]);
  const [showCriarAgenteModal, setShowCriarAgenteModal] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      window.location.href = '/login';
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const userRole = payload.role || 'regular';
      if (userRole !== 'admin') {
        window.location.href = '/dashboard/settings';
        return;
      }
    } catch {
      window.location.href = '/login';
      return;
    }
    setLoading(false);
    // TODO: carregar agentes da API quando existir
    setAgents([]);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/settings"
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Agentes de IA</h1>
            <p className="text-gray-600 mt-1">Todos os agentes de IA criados</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCriarAgenteModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          <Plus className="w-5 h-5" />
          Criar
        </button>
      </div>

      <CriarAgenteModal
        isOpen={showCriarAgenteModal}
        onClose={() => setShowCriarAgenteModal(false)}
        onSubmit={(data) => {
          // TODO: chamar API para criar agente
          console.log('Criar agente:', data);
        }}
      />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {agents.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-lg font-medium text-gray-700 mb-2">Nenhum agente criado</p>
            <p className="text-sm">Os agentes de IA criados aparecerão aqui.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {agents.map((agent) => (
              <li key={agent.id} className="px-6 py-4 hover:bg-gray-50 transition">
                <div className="font-medium text-gray-900">{agent.name}</div>
                {agent.description && (
                  <div className="text-sm text-gray-500 mt-1">{agent.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
