'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bot,
  ArrowLeft,
  Edit3,
  RotateCcw,
  Save,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  FlaskConical,
  X,
  Plus,
  Trash2,
  Sparkles,
} from 'lucide-react';

interface AiAgent {
  key: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  is_customized: boolean;
  is_builtin: boolean;
  updated_at: string | null;
}

const AVAILABLE_MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recomendado)' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

type Toast = { type: 'success' | 'error'; message: string };

const EMPTY_NEW_AGENT = {
  key: '',
  name: '',
  description: '',
  system_prompt: '',
  model: 'gemini-2.5-flash',
  temperature: 0.2,
  max_output_tokens: 4096,
};

export default function AgentesEditorPage() {
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [unsaved, setUnsaved] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newAgent, setNewAgent] = useState({ ...EMPTY_NEW_AGENT });
  const [creating, setCreating] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  const showToast = (type: Toast['type'], message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadAgents = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = '/login'; return; }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role !== 'admin') { window.location.href = '/dashboard'; return; }
    } catch { window.location.href = '/login'; return; }

    setLoading(true);
    try {
      const tok = localStorage.getItem('token')!;
      const res = await fetch('/api/ai-agents', {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar agentes');
      const data: AiAgent[] = await res.json();
      setAgents(data);
    } catch {
      showToast('error', 'Não foi possível carregar os agentes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const selectAgent = (agent: AiAgent) => {
    if (unsaved) {
      if (!confirm('Você tem alterações não salvas. Deseja descartar?')) return;
    }
    setSelectedKey(agent.key);
    setEditing({ ...agent });
    setUnsaved(false);
  };

  const handleChange = (field: keyof AiAgent, value: string | number) => {
    setEditing((prev) => prev ? { ...prev, [field]: value } : prev);
    setUnsaved(true);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const tok = localStorage.getItem('token')!;
      const res = await fetch(`/api/ai-agents/${editing.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          name: editing.name,
          description: editing.description,
          system_prompt: editing.system_prompt,
          model: editing.model,
          temperature: editing.temperature,
          max_output_tokens: editing.max_output_tokens,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Erro ao salvar');
      }
      const updated: AiAgent = await res.json();
      setAgents((prev) => prev.map((a) => (a.key === updated.key ? updated : a)));
      setEditing(updated);
      setUnsaved(false);
      showToast('success', 'Agente salvo com sucesso!');
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao salvar agente.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!editing) return;
    if (!confirm(`Resetar "${editing.name}" para os valores padrão?`)) return;
    setResetting(true);
    try {
      const tok = localStorage.getItem('token')!;
      const res = await fetch(`/api/ai-agents/${editing.key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Erro ao resetar');
      }
      const updated: AiAgent = await res.json();
      setAgents((prev) => prev.map((a) => (a.key === updated.key ? updated : a)));
      setEditing(updated);
      setUnsaved(false);
      showToast('success', 'Agente restaurado para o padrão.');
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao resetar agente.');
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`Excluir permanentemente o agente "${editing.name}"? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    try {
      const tok = localStorage.getItem('token')!;
      const res = await fetch(`/api/ai-agents/${editing.key}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Erro ao excluir');
      }
      setAgents((prev) => prev.filter((a) => a.key !== editing.key));
      setEditing(null);
      setSelectedKey(null);
      setUnsaved(false);
      showToast('success', 'Agente excluído com sucesso.');
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Erro ao excluir agente.');
    } finally {
      setDeleting(false);
    }
  };

  const handleClose = () => {
    if (unsaved) {
      if (!confirm('Você tem alterações não salvas. Deseja descartar?')) return;
    }
    setSelectedKey(null);
    setEditing(null);
    setUnsaved(false);
  };

  const openNewModal = () => {
    setNewAgent({ ...EMPTY_NEW_AGENT });
    setNewError(null);
    setShowNewModal(true);
  };

  const closeNewModal = () => {
    if (creating) return;
    setShowNewModal(false);
    setNewError(null);
  };

  const handleCreate = async () => {
    setNewError(null);
    if (!newAgent.key.trim()) { setNewError('A chave é obrigatória.'); return; }
    if (!newAgent.name.trim()) { setNewError('O nome é obrigatório.'); return; }
    if (!newAgent.system_prompt.trim()) { setNewError('O prompt do sistema é obrigatório.'); return; }

    setCreating(true);
    try {
      const tok = localStorage.getItem('token')!;
      const res = await fetch('/api/ai-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify(newAgent),
      });
      const data = await res.json();
      if (!res.ok) {
        setNewError((data as { error?: string }).error || 'Erro ao criar agente.');
        return;
      }
      const created = data as AiAgent;
      setAgents((prev) => [...prev, created]);
      setShowNewModal(false);
      showToast('success', `Agente "${created.name}" criado com sucesso!`);
      selectAgent(created);
    } catch {
      setNewError('Erro de conexão. Tente novamente.');
    } finally {
      setCreating(false);
    }
  };

  const builtinAgents = agents.filter((a) => a.is_builtin);
  const customAgents = agents.filter((a) => !a.is_builtin);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {toast.message}
        </div>
      )}

      {/* Modal Novo Agente */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-100 rounded-lg">
                  <Sparkles className="w-4 h-4 text-primary-600" />
                </div>
                <h2 className="font-semibold text-gray-900">Novo agente personalizado</h2>
              </div>
              <button onClick={closeNewModal} className="p-2 rounded-lg hover:bg-gray-100 transition" disabled={creating}>
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {newError && (
                <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {newError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Chave <span className="text-red-500">*</span>
                    <span className="ml-1 text-xs text-gray-400 font-normal">(identificador único)</span>
                  </label>
                  <input
                    type="text"
                    value={newAgent.key}
                    onChange={(e) => setNewAgent((p) => ({ ...p, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                    placeholder="ex: meu_agente_custom"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newAgent.name}
                    onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Nome exibido na lista"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <input
                  type="text"
                  value={newAgent.description}
                  onChange={(e) => setNewAgent((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Breve descrição do que este agente faz"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prompt do Sistema <span className="text-red-500">*</span>
                  <span className="ml-2 text-xs text-gray-400 font-normal">{newAgent.system_prompt.length} caracteres</span>
                </label>
                <textarea
                  value={newAgent.system_prompt}
                  onChange={(e) => setNewAgent((p) => ({ ...p, system_prompt: e.target.value }))}
                  rows={8}
                  placeholder="Instrução do sistema para o modelo de IA..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm font-mono leading-relaxed focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none resize-y"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
                  <select
                    value={newAgent.model}
                    onChange={(e) => setNewAgent((p) => ({ ...p, model: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Temperatura <span className="ml-1 text-xs text-gray-400">{newAgent.temperature}</span>
                  </label>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={newAgent.temperature}
                    onChange={(e) => setNewAgent((p) => ({ ...p, temperature: parseFloat(e.target.value) }))}
                    className="w-full mt-1"
                  />
                  <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                    <span>preciso</span><span>criativo</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Máx. tokens saída</label>
                  <input
                    type="number" min={256} max={16384} step={256}
                    value={newAgent.max_output_tokens}
                    onChange={(e) => setNewAgent((p) => ({ ...p, max_output_tokens: parseInt(e.target.value, 10) }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  onClick={closeNewModal}
                  disabled={creating}
                  className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 disabled:opacity-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  {creating ? 'Criando...' : 'Criar agente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/settings" className="p-2 rounded-lg hover:bg-gray-100 transition" aria-label="Voltar">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-xl">
              <FlaskConical className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Editor de Agentes IA</h1>
              <p className="text-sm text-gray-500 mt-0.5">Versão beta — personalize os prompts de cada agente</p>
            </div>
          </div>
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">BETA</span>
        </div>

        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Novo agente
        </button>
      </div>

      <div className="flex gap-6 items-start">
        {/* Lista de Agentes */}
        <div className={`flex-shrink-0 ${selectedKey ? 'w-80' : 'w-full max-w-2xl mx-auto'}`}>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Agentes predefinidos */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Predefinidos ({builtinAgents.length})</p>
            </div>
            <div className="divide-y divide-gray-100">
              {builtinAgents.map((agent) => (
                <AgentListItem key={agent.key} agent={agent} selectedKey={selectedKey} onClick={() => selectAgent(agent)} />
              ))}
            </div>

            {/* Agentes personalizados */}
            <div className="px-5 py-3 border-y border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Personalizados ({customAgents.length})</p>
            </div>
            {customAgents.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <p className="text-xs text-gray-400">Nenhum agente personalizado ainda.</p>
                <button onClick={openNewModal} className="mt-2 text-xs text-primary-600 hover:underline font-medium">
                  Criar agora →
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {customAgents.map((agent) => (
                  <AgentListItem key={agent.key} agent={agent} selectedKey={selectedKey} onClick={() => selectAgent(agent)} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Painel de Edição */}
        {editing && selectedKey && (
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${editing.is_builtin ? 'bg-primary-100' : 'bg-purple-100'}`}>
                    <Edit3 className={`w-4 h-4 ${editing.is_builtin ? 'text-primary-600' : 'text-purple-600'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{editing.name}</h2>
                      {!editing.is_builtin && (
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">personalizado</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 font-mono">{editing.key}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {unsaved && <span className="text-xs text-amber-600 font-medium">● alterações não salvas</span>}
                  <button onClick={handleClose} className="p-2 rounded-lg hover:bg-gray-100 transition" aria-label="Fechar editor">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                  <input
                    type="text" value={editing.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                  <input
                    type="text" value={editing.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Prompt do Sistema
                    <span className="ml-2 text-xs text-gray-400 font-normal">{editing.system_prompt.length} caracteres</span>
                  </label>
                  <textarea
                    value={editing.system_prompt}
                    onChange={(e) => handleChange('system_prompt', e.target.value)}
                    rows={12}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm font-mono leading-relaxed focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none resize-y"
                    placeholder="Instrução do sistema para o modelo de IA..."
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
                    <select
                      value={editing.model}
                      onChange={(e) => handleChange('model', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                    >
                      {AVAILABLE_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Temperatura <span className="ml-1 text-xs text-gray-400">{editing.temperature}</span>
                    </label>
                    <input
                      type="range" min={0} max={1} step={0.05}
                      value={editing.temperature}
                      onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                      className="w-full mt-1"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                      <span>preciso</span><span>criativo</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Máx. tokens saída</label>
                    <input
                      type="number" min={256} max={16384} step={256}
                      value={editing.max_output_tokens}
                      onChange={(e) => handleChange('max_output_tokens', parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>

                {editing.is_customized && editing.updated_at && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    <CheckCircle className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                    Última edição: {new Date(editing.updated_at).toLocaleString('pt-BR')}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  {editing.is_builtin ? (
                    <button
                      onClick={handleReset}
                      disabled={resetting || !editing.is_customized}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      title={!editing.is_customized ? 'Agente já está com valores padrão' : 'Restaurar valores padrão'}
                    >
                      <RotateCcw className={`w-4 h-4 ${resetting ? 'animate-spin' : ''}`} />
                      {resetting ? 'Resetando...' : 'Restaurar padrão'}
                    </button>
                  ) : (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 rounded-xl hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      {deleting ? 'Excluindo...' : 'Excluir agente'}
                    </button>
                  )}

                  <button
                    onClick={handleSave}
                    disabled={saving || !unsaved}
                    className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <FlaskConical className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Modo de teste</p>
                  <p className="text-xs text-amber-700 mt-1">
                    As alterações são salvas no banco e aplicadas imediatamente. Agentes predefinidos podem ser restaurados ao padrão.
                    Agentes personalizados podem ser excluídos definitivamente.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentListItem({
  agent,
  selectedKey,
  onClick,
}: {
  agent: AiAgent;
  selectedKey: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-4 flex items-center gap-3 transition hover:bg-gray-50 ${
        selectedKey === agent.key ? 'bg-primary-50 border-l-4 border-primary-600' : 'border-l-4 border-transparent'
      }`}
    >
      <div className={`p-2 rounded-lg flex-shrink-0 ${
        !agent.is_builtin ? 'bg-purple-100' : agent.is_customized ? 'bg-primary-100' : 'bg-gray-100'
      }`}>
        <Bot className={`w-4 h-4 ${
          !agent.is_builtin ? 'text-purple-600' : agent.is_customized ? 'text-primary-600' : 'text-gray-500'
        }`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 text-sm truncate">{agent.name}</span>
          {agent.is_customized && agent.is_builtin && (
            <span className="flex-shrink-0 px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full font-medium">editado</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{agent.description || '—'}</p>
        <p className="text-xs text-gray-400 mt-0.5">{agent.model}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
    </button>
  );
}
