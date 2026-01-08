import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Página não encontrada</h2>
        <p className="text-gray-600 mb-4">A página que você está procurando não existe.</p>
        <Link
          href="/"
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 inline-block"
        >
          Voltar para a página inicial
        </Link>
      </div>
    </div>
  );
}

