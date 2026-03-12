'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  GraduationCap, 
  BookOpen, 
  Brain, 
  Users, 
  FileText, 
  HelpCircle, 
  ClipboardList,
  CheckCircle2,
  Sparkles,
  Target,
  Zap,
  Shield,
  BarChart3,
  Image as ImageIcon,
  Tag,
  Award,
  TrendingUp,
  ArrowRight,
  Star,
  PlayCircle,
  Menu,
  X
} from 'lucide-react';

export default function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm">
        <nav className="container mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 min-w-0">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 sm:p-2 rounded-lg flex-shrink-0">
                <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent truncate">
                MedMind
              </span>
            </div>
            {/* Desktop nav */}
            <div className="hidden md:flex gap-2 lg:gap-4 items-center flex-shrink-0">
              <Link href="#features" className="px-3 py-2 text-gray-700 hover:text-blue-600 transition text-sm lg:text-base">
                Funcionalidades
              </Link>
              <Link href="#pricing" className="px-3 py-2 text-gray-700 hover:text-blue-600 transition text-sm lg:text-base">
                Planos
              </Link>
              <Link href="/login" className="px-3 py-2 text-gray-700 hover:text-blue-600 font-medium transition text-sm lg:text-base">
                Entrar
              </Link>
              <Link href="/login" className="px-4 lg:px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition shadow-lg shadow-blue-500/30 text-sm lg:text-base font-medium">
                Começar Grátis
              </Link>
            </div>
            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2.5 rounded-lg text-gray-700 hover:bg-gray-100 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-3 pt-3 border-t border-gray-200 flex flex-col gap-1">
              <Link href="#features" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition min-h-[44px] flex items-center">
                Funcionalidades
              </Link>
              <Link href="#pricing" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition min-h-[44px] flex items-center">
                Planos
              </Link>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition min-h-[44px] flex items-center font-medium">
                Entrar
              </Link>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="mx-4 mt-2 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-center font-medium min-h-[44px] flex items-center justify-center">
                Começar Grátis
              </Link>
            </div>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 pt-12 sm:pt-16 md:pt-20 pb-20 sm:pb-24 md:pb-32 px-4">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-10 left-4 w-40 h-40 sm:w-56 sm:h-56 md:w-72 md:h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob"></div>
          <div className="absolute top-32 right-4 w-40 h-40 sm:w-56 sm:h-56 md:w-72 md:h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-40 h-40 sm:w-56 sm:h-56 md:w-72 md:h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-4000"></div>
        </div>

        <div className="container mx-auto px-4 sm:px-6 relative z-10">
          <div className="text-center max-w-5xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-white/80 backdrop-blur-sm rounded-full text-xs sm:text-sm font-medium text-blue-600 mb-4 sm:mb-6 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] sm:max-w-none">Plataforma Completa para Estudantes de Medicina</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold text-gray-900 mb-4 sm:mb-6 leading-tight px-1">
              Domine a Medicina com
              <span className="block bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mt-1">
                Inteligência e Organização
              </span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl lg:text-2xl text-gray-600 mb-8 sm:mb-10 max-w-3xl mx-auto leading-relaxed px-1">
              Organize seus cases clínicos, pratique com milhares de questões, faça simulados personalizados e acelere seu aprendizado com uma plataforma feita por médicos, para médicos.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-stretch sm:items-center px-2">
              <Link href="/login" className="group px-6 sm:px-8 py-3.5 sm:py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-base sm:text-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition shadow-xl shadow-blue-500/30 flex items-center justify-center gap-2 min-h-[48px]">
                Começar Agora
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform flex-shrink-0" />
              </Link>
              <Link href="#features" className="px-6 sm:px-8 py-3.5 sm:py-4 bg-white text-gray-700 rounded-xl text-base sm:text-lg font-semibold hover:bg-gray-50 transition shadow-lg border-2 border-gray-200 flex items-center justify-center gap-2 min-h-[48px]">
                <PlayCircle className="w-5 h-5 flex-shrink-0" />
                Ver Demonstração
              </Link>
            </div>
            <div className="mt-10 sm:mt-14 md:mt-16 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 md:gap-8 max-w-4xl mx-auto">
              <div className="bg-white/60 backdrop-blur-sm p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg">
                <div className="text-2xl sm:text-3xl font-bold text-blue-600 mb-1 sm:mb-2">1000+</div>
                <div className="text-xs sm:text-sm text-gray-600">Questões</div>
              </div>
              <div className="bg-white/60 backdrop-blur-sm p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg">
                <div className="text-2xl sm:text-3xl font-bold text-indigo-600 mb-1 sm:mb-2">500+</div>
                <div className="text-xs sm:text-sm text-gray-600">Cases Clínicos</div>
              </div>
              <div className="bg-white/60 backdrop-blur-sm p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg">
                <div className="text-2xl sm:text-3xl font-bold text-purple-600 mb-1 sm:mb-2">50+</div>
                <div className="text-xs sm:text-sm text-gray-600">Especialidades</div>
              </div>
              <div className="bg-white/60 backdrop-blur-sm p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-lg">
                <div className="text-2xl sm:text-3xl font-bold text-pink-600 mb-1 sm:mb-2">24/7</div>
                <div className="text-xs sm:text-sm text-gray-600">Disponível</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 sm:py-16 md:py-24 bg-white">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14 md:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-3 sm:mb-4 px-2">
              Tudo que você precisa para
              <span className="block text-blue-600">estudar medicina</span>
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 px-2">
              Uma plataforma completa com ferramentas poderosas para organizar, praticar e dominar o conhecimento médico
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8 mb-10 sm:mb-16">
            {/* Feature 1 - Notas/Cases */}
            <div className="group bg-gradient-to-br from-blue-50 to-indigo-50 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border-2 border-blue-100 hover:border-blue-300 transition-all hover:shadow-xl">
              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-6 group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3">Organize Cases Clínicos</h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">
                Crie e organize seus casos clínicos com descrições detalhadas, imagens e tags por especialidade. Mantenha tudo organizado e acessível.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  Tags por especialidade
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  Suporte a imagens
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  Busca avançada
                </li>
              </ul>
            </div>

            {/* Feature 2 - Questões */}
            <div className="group bg-gradient-to-br from-purple-50 to-pink-50 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border-2 border-purple-100 hover:border-purple-300 transition-all hover:shadow-xl">
              <div className="bg-gradient-to-br from-purple-600 to-pink-600 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-6 group-hover:scale-110 transition-transform">
                <HelpCircle className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3">Banco de Questões</h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">
                Acesse milhares de questões de múltipla escolha com explicações detalhadas, organizadas por especialidade e ano de prova.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-600" />
                  Questões de residência
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-600" />
                  Explicações detalhadas
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-purple-600" />
                  Filtros avançados
                </li>
              </ul>
            </div>

            {/* Feature 3 - Simulados */}
            <div className="group bg-gradient-to-br from-green-50 to-emerald-50 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border-2 border-green-100 hover:border-green-300 transition-all hover:shadow-xl">
              <div className="bg-gradient-to-br from-green-600 to-emerald-600 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-6 group-hover:scale-110 transition-transform">
                <ClipboardList className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3">Simulados Personalizados</h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">
                Crie simulados personalizados com questões selecionadas. Use o modo rascunho para taxar alternativas e simular condições reais de prova.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Modo rascunho avançado
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Resultados detalhados
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Simulação real de provas
                </li>
              </ul>
            </div>

            {/* Feature 4 - Perfil Personalizado */}
            <div className="group bg-gradient-to-br from-orange-50 to-amber-50 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border-2 border-orange-100 hover:border-orange-300 transition-all hover:shadow-xl">
              <div className="bg-gradient-to-br from-orange-600 to-amber-600 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-6 group-hover:scale-110 transition-transform">
                <Target className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3">Perfil Personalizado</h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">
                Configure seu perfil acadêmico e receba recomendações personalizadas baseadas no seu nível e objetivos.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-orange-600" />
                  Wizard de onboarding
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-orange-600" />
                  Recomendações inteligentes
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-orange-600" />
                  Acompanhamento de progresso
                </li>
              </ul>
            </div>

            {/* Feature 5 - Tags e Organização */}
            <div className="group bg-gradient-to-br from-cyan-50 to-blue-50 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border-2 border-cyan-100 hover:border-cyan-300 transition-all hover:shadow-xl">
              <div className="bg-gradient-to-br from-cyan-600 to-blue-600 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-6 group-hover:scale-110 transition-transform">
                <Tag className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3">Organização por Tags</h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">
                Organize todo seu conteúdo com tags por especialidade: Ginecologia, Cirurgia Geral, Pediatria, MFC, Clínica Médica e mais.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-600" />
                  Tags por especialidade
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-600" />
                  Busca por tags
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-cyan-600" />
                  Filtros múltiplos
                </li>
              </ul>
            </div>

            {/* Feature 6 - Interface Moderna */}
            <div className="group bg-gradient-to-br from-indigo-50 to-purple-50 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl border-2 border-indigo-100 hover:border-indigo-300 transition-all hover:shadow-xl">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4 sm:mb-6 group-hover:scale-110 transition-transform">
                <Zap className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3">Interface Intuitiva</h3>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">
                Uma interface moderna e responsiva, projetada para ser rápida e fácil de usar, permitindo que você foque no que importa: estudar.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  Design responsivo
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  Navegação intuitiva
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  Performance otimizada
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-12 sm:py-16 md:py-24 bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14 md:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-3 sm:mb-4 px-2">
              Planos que se adaptam a você
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 px-2">
              Escolha o plano ideal para sua jornada de estudos. Comece grátis e atualize quando precisar de mais recursos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-5xl mx-auto">
            {/* Plano Gratuito */}
            <div className="bg-white p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl shadow-xl border-2 border-gray-200 hover:border-gray-300 transition-all">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl mb-4">
                  <BookOpen className="w-8 h-8 text-gray-600" />
                </div>
                <h3 className="text-3xl font-bold text-gray-900 mb-2">Plano Gratuito</h3>
                <div className="flex items-baseline justify-center gap-2 mb-4">
                  <span className="text-5xl font-bold text-gray-900">R$ 0</span>
                  <span className="text-gray-500">/mês</span>
                </div>
                <p className="text-gray-600">Perfeito para começar seus estudos</p>
              </div>

              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">Até 50 notas/cases clínicos</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">Acesso a todas as questões</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">Até 3 simulados por mês</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">Organização por tags</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">Perfil personalizado</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">Suporte por email</span>
                </li>
              </ul>

              <Link
                href="/login"
                className="block w-full text-center px-6 py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition shadow-lg"
              >
                Começar Grátis
              </Link>
            </div>

            {/* Plano Premium */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-5 sm:p-6 md:p-8 rounded-xl sm:rounded-2xl shadow-2xl border-4 border-blue-400 relative overflow-hidden">
              {/* Badge */}
              <div className="absolute top-6 right-6">
                <span className="bg-yellow-400 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold">
                  MAIS POPULAR
                </span>
              </div>

              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full -ml-12 -mb-12"></div>

              <div className="relative z-10">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl mb-4">
                    <Award className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-3xl font-bold text-white mb-2">Plano Premium</h3>
                  <div className="flex items-baseline justify-center gap-2 mb-4">
                    <span className="text-5xl font-bold text-white">R$ 30</span>
                    <span className="text-blue-100">/mês</span>
                  </div>
                  <p className="text-blue-100">Para estudantes sérios e profissionais</p>
                </div>

                <ul className="space-y-4 mb-8">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Notas/cases ilimitados</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Acesso a todas as questões</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Simulados ilimitados</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Organização por tags avançada</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Perfil personalizado completo</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Estatísticas de desempenho</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Exportação de dados</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Suporte prioritário</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                    <span className="text-white">Acesso antecipado a novas funcionalidades</span>
                  </li>
                </ul>

                <Link
                  href="/login"
                  className="block w-full text-center px-6 py-3 bg-white text-blue-600 rounded-xl font-semibold hover:bg-gray-50 transition shadow-xl"
                >
                  Assinar Premium
                </Link>
              </div>
            </div>
          </div>

          {/* FAQ ou garantia */}
          <div className="mt-16 text-center">
            <p className="text-gray-600 mb-4">
              <Shield className="w-5 h-5 inline mr-2 text-blue-600" />
              Cancele a qualquer momento. Sem compromisso.
            </p>
            <p className="text-sm text-gray-500">
              Todos os planos incluem atualizações automáticas e suporte contínuo
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 sm:py-16 md:py-20 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 sm:mb-6 px-2">
              Pronto para transformar seus estudos?
            </h2>
            <p className="text-base sm:text-lg md:text-xl text-blue-100 mb-6 sm:mb-8 px-2">
              Junte-se a milhares de estudantes que já estão usando o MedMind para alcançar seus objetivos.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-stretch sm:items-center">
              <Link
                href="/login"
                className="px-8 py-4 bg-white text-blue-600 rounded-xl text-lg font-semibold hover:bg-gray-50 transition shadow-xl flex items-center justify-center gap-2"
              >
                Começar Agora
                <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="#features"
                className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white rounded-xl text-lg font-semibold hover:bg-white/20 transition border-2 border-white/30"
              >
                Ver Funcionalidades
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10 sm:py-12">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap className="w-6 h-6 text-blue-400" />
                <span className="text-xl font-bold text-white">MedMind</span>
              </div>
              <p className="text-sm">
                Plataforma completa para estudantes e profissionais de medicina.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Produto</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="#features" className="hover:text-white transition">Funcionalidades</Link></li>
                <li><Link href="#pricing" className="hover:text-white transition">Planos</Link></li>
                <li><Link href="/login" className="hover:text-white transition">Login</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Recursos</h4>
              <ul className="space-y-2 text-sm">
                <li><span className="cursor-pointer hover:text-white transition">Notas e Cases</span></li>
                <li><span className="cursor-pointer hover:text-white transition">Questões</span></li>
                <li><span className="cursor-pointer hover:text-white transition">Simulados</span></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Suporte</h4>
              <ul className="space-y-2 text-sm">
                <li><span className="cursor-pointer hover:text-white transition">Central de Ajuda</span></li>
                <li><span className="cursor-pointer hover:text-white transition">Contato</span></li>
                <li><span className="cursor-pointer hover:text-white transition">Termos de Uso</span></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm">
            <p>&copy; 2024 MedMind. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
