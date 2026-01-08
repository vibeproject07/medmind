import Link from 'next/link';
import { GraduationCap, BookOpen, Brain, Users } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <nav className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-8 h-8 text-primary-600" />
            <span className="text-2xl font-bold text-gray-800">MedMind</span>
          </div>
          <div className="flex gap-4">
            <Link href="/login" className="px-4 py-2 text-gray-700 hover:text-primary-600">
              Entrar
            </Link>
            <Link href="/login" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              Começar
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Sua Plataforma de Estudos
            <span className="text-primary-600"> Médicos</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Organize cases, materiais de estudo e tenha o apoio da IA para acelerar seu aprendizado
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/login"
              className="px-8 py-4 bg-primary-600 text-white rounded-lg text-lg font-semibold hover:bg-primary-700 transition"
            >
              Começar Agora
            </Link>
            <Link
              href="#features"
              className="px-8 py-4 bg-white text-primary-600 rounded-lg text-lg font-semibold hover:bg-gray-50 transition"
            >
              Saiba Mais
            </Link>
          </div>
        </div>

        {/* Features */}
        <div id="features" className="mt-32 grid md:grid-cols-3 gap-8">
          <div className="bg-white p-8 rounded-xl shadow-lg">
            <BookOpen className="w-12 h-12 text-primary-600 mb-4" />
            <h3 className="text-2xl font-bold mb-3">Organize Cases</h3>
            <p className="text-gray-600">
              Mantenha todos os seus casos clínicos organizados e acessíveis em um só lugar
            </p>
          </div>
          <div className="bg-white p-8 rounded-xl shadow-lg">
            <Brain className="w-12 h-12 text-primary-600 mb-4" />
            <h3 className="text-2xl font-bold mb-3">IA Integrada</h3>
            <p className="text-gray-600">
              Tenha o apoio de inteligência artificial para estudar e revisar conteúdos
            </p>
          </div>
          <div className="bg-white p-8 rounded-xl shadow-lg">
            <Users className="w-12 h-12 text-primary-600 mb-4" />
            <h3 className="text-2xl font-bold mb-3">Comunidade</h3>
            <p className="text-gray-600">
              Conecte-se com outros estudantes e profissionais de medicina
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center text-gray-600">
        <p>&copy; 2024 MedMind. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}

