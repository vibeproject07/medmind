'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Mail, Plus, List, MessageSquare, Upload, CheckCircle, AlertCircle, Loader2, LogIn } from 'lucide-react';
import CriarAgenteModal from '@/components/Dashboard/CriarAgenteModal';

interface Setting {
  id: number;
  key: string;
  value: string;
  description: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailConfig, setEmailConfig] = useState({
    host: '',
    port: '',
    user: '',
    password: '',
  });
  const [testingEmail, setTestingEmail] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCriarAgenteModal, setShowCriarAgenteModal] = useState(false);

  const comentariosFileRef = useRef<HTMLInputElement>(null);
  const [importingComentarios, setImportingComentarios] = useState(false);
  const [comentariosStatus, setComentariosStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [comentariosSessionExpired, setComentariosSessionExpired] = useState(false);

  useEffect(() => {
    // Verificar permissão antes de carregar
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const userRole = payload.role || 'regular';
        setIsAdmin(userRole === 'admin');

        // Verificar permissão: apenas admin e manager podem acessar
        if (userRole === 'regular') {
          window.location.href = '/dashboard';
          return;
        }
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
        window.location.href = '/dashboard';
        return;
      }
    } else {
      window.location.href = '/login';
      return;
    }

    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      let token = localStorage.getItem('token');
      
      if (!token) {
        setLoading(false);
        return;
      }

      // Limpar token: remover espaços e possíveis aspas
      token = token.trim().replace(/^["']|["']$/g, '');

      const response = await fetch('/api/settings', {
        headers: { 
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Erro ao buscar configurações:', errorData);
        setLoading(false);
        return;
      }

      const data = await response.json();
      setSettings(data);

      // Carregar configuração de email se existir
      const emailSetting = data.find((s: Setting) => s.key === 'email_smtp');
      if (emailSetting) {
        try {
          setEmailConfig(JSON.parse(emailSetting.value));
        } catch (parseError) {
          console.error('Erro ao parsear configuração de email:', parseError);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar configurações:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailConfig.host || !emailConfig.port || !emailConfig.user || !emailConfig.password) {
      alert('Configure o email primeiro antes de testar.');
      return;
    }

    setTestingEmail(true);
    let token = localStorage.getItem('token');
    
    if (!token) {
      alert('Token não encontrado. Faça login novamente.');
      window.location.href = '/login';
      return;
    }

    token = token.trim().replace(/^["']|["']$/g, '');

    try {
      const response = await fetch('/api/settings/email_smtp/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Email de teste enviado com sucesso para ${data.to}!\n\nVerifique sua caixa de entrada.`);
      } else {
        console.error('Erro ao enviar email de teste:', data);
        let errorMsg = data.error || 'Erro ao enviar email de teste';
        
        // Adicionar detalhes se disponíveis
        if (data.details) {
          errorMsg += `\n\nDetalhes: ${JSON.stringify(data.details, null, 2)}`;
        }
        
        // Dicas para Gmail
        if (errorMsg.includes('autenticação') || errorMsg.includes('EAUTH')) {
          errorMsg += '\n\n💡 Dica para Gmail:\n';
          errorMsg += '1. Use uma "Senha de App" ao invés da senha normal\n';
          errorMsg += '2. Ative a verificação em duas etapas\n';
          errorMsg += '3. Gere uma senha de app em: https://myaccount.google.com/apppasswords';
        }
        
        alert(errorMsg);
      }
    } catch (error: any) {
      console.error('Erro ao enviar email de teste:', error);
      alert('Erro de conexão. Tente novamente.');
    } finally {
      setTestingEmail(false);
    }
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    let token = localStorage.getItem('token');
    
    if (!token) {
      alert('Token não encontrado. Faça login novamente.');
      window.location.href = '/login';
      return;
    }

    // Limpar token: remover espaços e possíveis aspas
    token = token.trim().replace(/^["']|["']$/g, '');

    try {
      const response = await fetch('/api/settings/email_smtp', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify(emailConfig),
      });

      const data = await response.json();

      if (response.ok) {
        fetchSettings();
        setShowEmailModal(false);
        alert('Configuração de email salva com sucesso!');
      } else {
        console.error('Erro ao salvar configuração:', data);
        alert(data.error || 'Erro ao salvar configuração');
        
        // Se o erro for de token inválido, redirecionar para login
        if (response.status === 401) {
          localStorage.removeItem('token');
          document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);
        }
      }
    } catch (error: any) {
      console.error('Erro ao salvar configuração:', error);
      alert('Erro de conexão. Tente novamente.');
    }
  };

  const handleComentariosFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
    const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';

    if (!isCsv && !isJson) {
      setComentariosStatus({ type: 'error', message: 'Formato não suportado. Envie um arquivo .json ou .csv.' });
      return;
    }

    setImportingComentarios(true);
    setComentariosStatus(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result as string;

        const token = localStorage.getItem('token')?.trim().replace(/^["']|["']$/g, '');
        if (!token) {
          setComentariosStatus({ type: 'error', message: 'Sessão expirada. Faça login novamente.' });
          setImportingComentarios(false);
          return;
        }

        const contentType = isCsv ? 'text/csv' : 'application/json';

        if (isJson) {
          try { JSON.parse(text); } catch {
            setComentariosStatus({ type: 'error', message: 'O arquivo não é um JSON válido.' });
            setImportingComentarios(false);
            return;
          }
        }

        const res = await fetch('/api/comentarios/import', {
          method: 'POST',
          headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
          body: text,
        });

        const data = await res.json();
        if (res.ok) {
          const msg = data.message || 'Importação concluída com sucesso.';
          const extras = data.erros?.length
            ? ` ${data.erros.length} erro(s) ignorado(s).`
            : '';
          setComentariosStatus({ type: 'success', message: msg + extras });
          setComentariosSessionExpired(false);
        } else if (res.status === 401 || res.status === 403) {
          setComentariosSessionExpired(true);
          setComentariosStatus(null);
        } else {
          setComentariosStatus({ type: 'error', message: data.error || 'Erro ao importar comentários.' });
        }
      } catch {
        setComentariosStatus({ type: 'error', message: 'Erro inesperado ao processar o arquivo.' });
      } finally {
        setImportingComentarios(false);
      }
    };
    reader.onerror = () => {
      setComentariosStatus({ type: 'error', message: 'Erro ao ler o arquivo.' });
      setImportingComentarios(false);
    };
    reader.readAsText(file, 'UTF-8');
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Configurações</h1>

      <div className="grid gap-6">
        {/* Configuração de Email */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Mail className="w-6 h-6 text-primary-600" />
              <h2 className="text-xl font-semibold">Configuração de Email (SMTP)</h2>
            </div>
            <div className="flex gap-2">
              {emailConfig.host && (
                <button
                  onClick={handleTestEmail}
                  disabled={testingEmail}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {testingEmail ? 'Enviando...' : 'Testar Email'}
                </button>
              )}
              <button
                onClick={() => setShowEmailModal(true)}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                {emailConfig.host ? 'Editar' : 'Configurar'}
              </button>
            </div>
          </div>
          {emailConfig.host && (
            <div className="text-sm text-gray-600">
              <p><strong>Host:</strong> {emailConfig.host}</p>
              <p><strong>Porta:</strong> {emailConfig.port}</p>
              <p><strong>Usuário:</strong> {emailConfig.user}</p>
            </div>
          )}
        </div>

        {/* Agentes de IA */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Agentes de IA</h2>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowCriarAgenteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              <Plus className="w-5 h-5" />
              Criar
            </button>
            {isAdmin && (
              <Link
                href="/dashboard/settings/agentes-ia"
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
              >
                <List className="w-5 h-5" />
                Ver Todos
              </Link>
            )}
          </div>
        </div>

        {/* Importar Comentários — apenas admin */}
        {isAdmin && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <MessageSquare className="w-6 h-6 text-primary-600" />
              <h2 className="text-xl font-semibold text-gray-900">Importar comentários</h2>
            </div>

            <p className="text-sm text-gray-500 mb-5">
              Selecione um arquivo <strong>.json</strong> ou <strong>.csv</strong> gerado pelo script de comentários.
              O JSON pode estar no formato simples <code className="text-xs bg-gray-100 px-1 rounded">{'{"questoes":[...]}'}</code> ou
              no formato de saída do script <code className="text-xs bg-gray-100 px-1 rounded">{'{"comentarios":[...]}'}</code>.
              O CSV deve conter as colunas <code className="text-xs bg-gray-100 px-1 rounded">questao_id</code> e <code className="text-xs bg-gray-100 px-1 rounded">comentario</code>.
            </p>

            <input
              ref={comentariosFileRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={handleComentariosFileChange}
            />

            <button
              type="button"
              disabled={importingComentarios}
              onClick={() => { setComentariosStatus(null); setComentariosSessionExpired(false); comentariosFileRef.current?.click(); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {importingComentarios ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Escolher arquivo
                </>
              )}
            </button>

            {comentariosSessionExpired && (
              <div className="mt-4 flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                <LogIn className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <span className="flex-1">Sessão expirada. Faça login novamente para importar.</span>
                <Link
                  href="/login"
                  className="flex items-center gap-1 font-semibold underline hover:text-amber-900"
                >
                  Ir para login
                </Link>
              </div>
            )}
            {comentariosStatus && (
              <div className={`mt-4 flex items-start gap-2 text-sm rounded-lg px-4 py-3 ${
                comentariosStatus.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {comentariosStatus.type === 'success'
                  ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                }
                <span>{comentariosStatus.message}</span>
              </div>
            )}
          </div>
        )}

        {/* Lista de outras configurações */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold">Todas as Configurações</h2>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chave</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valor</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Descrição</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {settings.map((setting) => (
                <tr key={setting.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{setting.key}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {setting.key === 'email_smtp' ? '[Configuração SMTP]' : setting.value}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{setting.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Configuração de Email */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">Configuração de Email SMTP</h2>
            <form onSubmit={handleSaveEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Host SMTP</label>
                <input
                  type="text"
                  required
                  value={emailConfig.host}
                  onChange={(e) => setEmailConfig({ ...emailConfig, host: e.target.value })}
                  placeholder="smtp.gmail.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Porta</label>
                <input
                  type="number"
                  required
                  value={emailConfig.port}
                  onChange={(e) => setEmailConfig({ ...emailConfig, port: e.target.value })}
                  placeholder="587"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Usuário/Email</label>
                <input
                  type="email"
                  required
                  value={emailConfig.user}
                  onChange={(e) => setEmailConfig({ ...emailConfig, user: e.target.value })}
                  placeholder="seu@email.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                <input
                  type="password"
                  required
                  value={emailConfig.password}
                  onChange={(e) => setEmailConfig({ ...emailConfig, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="flex gap-4">
                <button
                  type="submit"
                  className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CriarAgenteModal
        isOpen={showCriarAgenteModal}
        onClose={() => setShowCriarAgenteModal(false)}
        onSubmit={(data) => {
          // TODO: chamar API para criar agente
          console.log('Criar agente:', data);
        }}
      />
    </div>
  );
}

