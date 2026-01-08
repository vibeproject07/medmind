'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Erro na aplicação:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Algo deu errado!</h2>
        <p className="text-gray-600 mb-4">{error.message || 'Ocorreu um erro inesperado'}</p>
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

