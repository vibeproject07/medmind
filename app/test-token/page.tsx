'use client';

import { useState } from 'react';

export default function TestTokenPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testToken = async () => {
    setLoading(true);
    setResult(null);

    try {
      const token = localStorage.getItem('token');
      
      if (!token) {
        setResult({ error: 'Token não encontrado no localStorage' });
        setLoading(false);
        return;
      }

      console.log('🔍 Token do localStorage:', {
        existe: !!token,
        tipo: typeof token,
        tamanho: token.length,
        inicio: token.substring(0, 30),
        partes: token.split('.').length,
        temAspas: token.startsWith('"') || token.endsWith('"')
      });

      // Limpar token
      const cleanToken = token.trim().replace(/^["']|["']$/g, '');
      
      // Testar com a API de debug
      const response = await fetch('/api/debug-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`
        },
        body: JSON.stringify({ token: cleanToken })
      });

      const data = await response.json();
      setResult(data);
      console.log('📥 Resultado:', data);
    } catch (error: any) {
      setResult({ error: error.message });
      console.error('❌ Erro:', error);
    } finally {
      setLoading(false);
    }
  };

  const testCreateUser = async () => {
    setLoading(true);
    setResult(null);

    try {
      const token = localStorage.getItem('token');
      
      if (!token) {
        setResult({ error: 'Token não encontrado no localStorage' });
        setLoading(false);
        return;
      }

      const cleanToken = token.trim().replace(/^["']|["']$/g, '');

      console.log('📤 Tentando criar usuário com token:', cleanToken.substring(0, 30) + '...');

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`
        },
        credentials: 'include',
        body: JSON.stringify({
          name: 'Teste Usuário',
          email: `teste${Date.now()}@teste.com`,
          password: '123456',
          role: 'regular'
        })
      });

      const data = await response.json();
      setResult({
        status: response.status,
        ok: response.ok,
        data
      });
      console.log('📥 Resultado da criação:', { status: response.status, data });
    } catch (error: any) {
      setResult({ error: error.message });
      console.error('❌ Erro:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Teste de Token</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Token Atual</h2>
          <div className="bg-gray-100 p-4 rounded mb-4">
            <pre className="text-xs overflow-auto">
              {localStorage.getItem('token') || 'Nenhum token encontrado'}
            </pre>
          </div>
          
          <div className="flex gap-4">
            <button
              onClick={testToken}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Testando...' : 'Testar Token'}
            </button>
            
            <button
              onClick={testCreateUser}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Criando...' : 'Testar Criar Usuário'}
            </button>
            
            <button
              onClick={() => {
                localStorage.removeItem('token');
                document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
                setResult(null);
              }}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Limpar Token
            </button>
          </div>
        </div>

        {result && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Resultado</h2>
            <pre className="bg-gray-100 p-4 rounded text-xs overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-6">
          <a href="/login" className="text-blue-600 hover:underline">
            ← Voltar para Login
          </a>
        </div>
      </div>
    </div>
  );
}

