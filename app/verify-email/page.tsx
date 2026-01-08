'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { GraduationCap, CheckCircle, XCircle } from 'lucide-react';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      setStatus('error');
      setMessage('Token não fornecido');
      return;
    }

    fetch(`/api/auth/verify-email?token=${token}`)
      .then(async (response) => {
        const data = await response.json();
        
        if (response.ok) {
          setStatus('success');
          setMessage(data.message || 'Email confirmado com sucesso!');
          setTimeout(() => {
            router.push('/login');
          }, 3000);
        } else {
          setStatus('error');
          setMessage(data.error || 'Erro ao verificar email');
        }
      })
      .catch((error) => {
        setStatus('error');
        setMessage('Erro de conexão. Tente novamente.');
        console.error('Erro ao verificar email:', error);
      });
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <GraduationCap className="w-10 h-10 text-primary-600" />
          <span className="text-3xl font-bold text-gray-800">MedMind</span>
        </div>

        {status === 'loading' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Verificando email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Email Confirmado!</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <p className="text-sm text-gray-500">Redirecionando para o login...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Erro</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <Link
              href="/login"
              className="inline-block px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Voltar para Login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

