'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GraduationCap } from 'lucide-react';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin 
        ? { email: formData.email, password: formData.password } // No login, o campo email pode conter username ou email
        : formData;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log('📥 Resposta recebida:', {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      const data = await response.json();
      console.log('📦 Dados recebidos:', {
        hasToken: !!data.token,
        tokenType: typeof data.token,
        tokenLength: data.token?.length,
        tokenStart: data.token?.substring(0, 30),
        error: data.error,
        user: data.user
      });

      if (response.ok) {
        // Se for registro, não esperar token
        if (!isLogin) {
          // Registro bem-sucedido
          alert(data.message || 'Conta criada com sucesso! Verifique seu email para confirmar sua conta antes de fazer login.');
          setIsLogin(true);
          setFormData({ name: '', username: '', email: '', password: '' });
          setLoading(false);
          return;
        }

        // Para login, processar token
        let cleanToken = data.token?.trim();
        
        if (!cleanToken) {
          console.error('❌ Token não recebido do servidor');
          console.error('📦 Dados completos:', JSON.stringify(data, null, 2));
          setError('Token não recebido do servidor. Verifique o console para mais detalhes.');
          setLoading(false);
          return;
        }
        
        // Remover possíveis aspas
        cleanToken = cleanToken.replace(/^["']|["']$/g, '');
        
        // Validar formato básico do JWT (deve ter 3 partes separadas por ponto)
        if (cleanToken.split('.').length !== 3) {
          console.error('❌ Token com formato inválido:', cleanToken.substring(0, 50));
          setError('Token recebido com formato inválido');
          setLoading(false);
          return;
        }
        
        // Salvar no localStorage
        try {
          localStorage.setItem('token', cleanToken);
          const savedToken = localStorage.getItem('token');
          console.log('💾 Token salvo no localStorage:', {
            success: savedToken === cleanToken,
            savedLength: savedToken?.length,
            savedStart: savedToken?.substring(0, 30),
            originalLength: cleanToken.length,
            originalStart: cleanToken.substring(0, 30)
          });
          
          if (savedToken !== cleanToken) {
            console.error('❌ Token não foi salvo corretamente!');
            setError('Erro ao salvar token no localStorage');
            setLoading(false);
            return;
          }
        } catch (storageError) {
          console.error('❌ Erro ao salvar no localStorage:', storageError);
          setError('Erro ao salvar token. Verifique se o localStorage está habilitado.');
          setLoading(false);
          return;
        }
        
        // Aguardar um pouco para garantir que o cookie foi setado
        setTimeout(() => {
          console.log('🚀 Redirecionando para dashboard...');
          window.location.href = '/dashboard';
        }, 100);
      } else {
        console.error('❌ Erro na resposta:', data);
        
        // Verificar se é erro de email não verificado
        if (data.requiresVerification) {
          setError(data.error || 'Email não confirmado. Verifique sua caixa de entrada.');
        } else {
          setError(data.error || 'Erro ao processar solicitação');
        }
      }
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotPasswordLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setForgotPasswordSuccess(true);
      } else {
        setError(data.error || 'Erro ao solicitar recuperação de senha');
      }
    } catch (err) {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <GraduationCap className="w-10 h-10 text-primary-600" />
          <span className="text-3xl font-bold text-gray-800">MedMind</span>
        </div>

        <div className="flex gap-4 mb-6 border-b">
          <button
            onClick={() => setIsLogin(true)}
            className={`pb-3 px-4 font-semibold transition ${
              isLogin
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Entrar
          </button>
          <button
            onClick={() => setIsLogin(false)}
            className={`pb-3 px-4 font-semibold transition ${
              !isLogin
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Cadastrar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  required={!isLogin}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Seu nome completo"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="seu_username (opcional)"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isLogin ? 'Username ou Email' : 'Email'}
            </label>
            <input
              type={isLogin ? 'text' : 'email'}
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder={isLogin ? 'admin ou seu@email.com' : 'seu@email.com'}
            />
          </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    Senha
                  </label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      Esqueci minha senha
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50"
          >
            {loading ? 'Processando...' : isLogin ? 'Entrar' : 'Cadastrar'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/" className="text-primary-600 hover:text-primary-700 text-sm">
            Voltar para a página inicial
          </Link>
        </div>
      </div>

      {/* Modal de Esqueci Minha Senha */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
            {!forgotPasswordSuccess ? (
              <>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Recuperar Senha</h2>
                <p className="text-gray-600 mb-6">
                  Digite seu email e enviaremos um link para redefinir sua senha.
                </p>
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      required
                      value={forgotPasswordEmail}
                      onChange={(e) => setForgotPasswordEmail(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="seu@email.com"
                    />
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-4">
                    <button
                      type="submit"
                      disabled={forgotPasswordLoading}
                      className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    >
                      {forgotPasswordLoading ? 'Enviando...' : 'Enviar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(false);
                        setForgotPasswordEmail('');
                        setError('');
                        setForgotPasswordSuccess(false);
                      }}
                      className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Enviado!</h2>
                  <p className="text-gray-600 mb-6">
                    Se o email estiver cadastrado, você receberá um link para redefinir sua senha.
                  </p>
                  <button
                    onClick={() => {
                      setShowForgotPassword(false);
                      setForgotPasswordEmail('');
                      setForgotPasswordSuccess(false);
                    }}
                    className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700"
                  >
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

