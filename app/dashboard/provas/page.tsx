'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Filter, FolderOpen, Loader2, X, Play, ChevronLeft, ChevronRight, CheckCircle, XCircle, Ban, AlertTriangle, LogIn } from 'lucide-react';

interface ProvaQuestion {
  id: number;
  numero_na_prova: number | null;
  statement: string;
  option_a: string;
  option_b: string;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  correct_answer: string;
  images?: string[];
  exam_board?: string | null;
  exam_region?: string | null;
  exam_year?: number | null;
  exam_type?: string | null;
  anulada?: boolean;
}

interface Prova {
  id: number;
  nome: string;
  banca: string | null;
  regiao: string | null;
  ano: string | null;
  tipo: string | null;
  created_at: string;
  questions: ProvaQuestion[];
}

interface ImportSummary {
  provasImportadas: number;
  provasIgnoradas: number;
  questoesImportadas: number;
}

const ANO_INICIO = 1990;
const ANO_FIM = new Date().getFullYear();
const ANOS = Array.from({ length: ANO_FIM - ANO_INICIO + 1 }, (_, i) => String(ANO_FIM - i));

export default function ProvasPage() {
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [banca, setBanca] = useState('');
  const [regiao, setRegiao] = useState('');
  const [ano, setAno] = useState('');
  const [tipo, setTipo] = useState('');
  const [showFileModal, setShowFileModal] = useState(false);
  const [loadingJson, setLoadingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [provasList, setProvasList] = useState<Prova[]>([]);
  const [loadingProvas, setLoadingProvas] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [provaEmAndamento, setProvaEmAndamento] = useState<Prova | null>(null);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [showExamResults, setShowExamResults] = useState(false);

  const fetchProvas = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoadingProvas(false);
      return;
    }
    try {
      const res = await fetch('/api/provas', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setProvasList(Array.isArray(data) ? data : []);
      } else if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProvas(false);
    }
  };

  useEffect(() => {
    fetchProvas();
  }, []);

  // Extrair opções únicas de banca e tipo a partir dos dados carregados
  const bancasDisponiveis = Array.from(
    new Set(provasList.map((p) => p.banca).filter(Boolean) as string[])
  ).sort();

  const tiposDisponiveis = Array.from(
    new Set(provasList.map((p) => p.tipo).filter(Boolean) as string[])
  ).sort();

  const handleAbrirSelecao = () => {
    setJsonError(null);
    setImportSummary(null);
    setSessionExpired(false);
    setShowFileModal(true);
  };

  const handleEscolherArquivo = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLoadingJson(true);
    setJsonError(null);
    setImportSummary(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result as string;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setJsonError('O arquivo não é um JSON válido.');
          setLoadingJson(false);
          return;
        }

        // Suporta array plano de questões: [ { enunciado, alternativas, letra_correta, ... } ]
        let data: Record<string, unknown>;
        if (Array.isArray(parsed)) {
          data = { provas: [{ nome: 'Importação', questoes: parsed }] };
        } else if (parsed && typeof parsed === 'object') {
          data = parsed as Record<string, unknown>;
        } else {
          setJsonError('Formato não reconhecido. O arquivo deve ser um JSON com provas ou um array de questões.');
          setLoadingJson(false);
          return;
        }

        const hasProvas = Array.isArray(data.provas) && (data.provas as unknown[]).length > 0;
        const hasPaginas = Array.isArray(data.paginas) && (data.paginas as unknown[]).length > 0;
        if (!hasProvas && !hasPaginas) {
          setJsonError('O JSON deve conter um array "provas", "paginas" (formato antigo), ou ser diretamente um array de questões.');
          setLoadingJson(false);
          return;
        }
        const token = localStorage.getItem('token');
        if (!token) {
          setSessionExpired(true);
          setLoadingJson(false);
          return;
        }

        const BATCH_SIZE = 10;
        let totalImportadas = 0;
        let totalIgnoradas = 0;
        let totalQuestoes = 0;

        if (hasProvas) {
          const allProvas = data.provas as unknown[];
          const batches: unknown[][] = [];
          for (let i = 0; i < allProvas.length; i += BATCH_SIZE) {
            batches.push(allProvas.slice(i, i + BATCH_SIZE));
          }
          setImportProgress({ current: 0, total: batches.length });
          for (let i = 0; i < batches.length; i++) {
            setImportProgress({ current: i + 1, total: batches.length });
            const res = await fetch('/api/provas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ provas: batches[i] }),
            });
            const body = await res.json();
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) {
                setSessionExpired(true);
              } else {
                setJsonError(body.error || 'Erro ao importar lote.');
              }
              setLoadingJson(false);
              setImportProgress(null);
              return;
            }
            totalImportadas += body.summary?.provasImportadas ?? 0;
            totalIgnoradas += body.summary?.provasIgnoradas ?? 0;
            totalQuestoes += body.summary?.questoesImportadas ?? 0;
          }
        } else {
          const allPaginas = data.paginas as unknown[];
          const batches: unknown[][] = [];
          for (let i = 0; i < allPaginas.length; i += BATCH_SIZE * 4) {
            batches.push(allPaginas.slice(i, i + BATCH_SIZE * 4));
          }
          setImportProgress({ current: 0, total: batches.length });
          for (let i = 0; i < batches.length; i++) {
            setImportProgress({ current: i + 1, total: batches.length });
            const res = await fetch('/api/provas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ paginas: batches[i] }),
            });
            const body = await res.json();
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) {
                setSessionExpired(true);
              } else {
                setJsonError(body.error || 'Erro ao importar lote.');
              }
              setLoadingJson(false);
              setImportProgress(null);
              return;
            }
            totalImportadas += body.summary?.provasImportadas ?? 0;
            totalIgnoradas += body.summary?.provasIgnoradas ?? 0;
            totalQuestoes += body.summary?.questoesImportadas ?? 0;
          }
        }

        setImportProgress(null);
        setShowFileModal(false);
        setImportSummary({ provasImportadas: totalImportadas, provasIgnoradas: totalIgnoradas, questoesImportadas: totalQuestoes });
        await fetchProvas();
      } catch (err) {
        console.error('Erro na importação:', err);
        setJsonError('Ocorreu um erro ao processar o arquivo. Verifique se é um JSON válido.');
      } finally {
        setLoadingJson(false);
        setImportProgress(null);
      }
    };
    reader.onerror = () => {
      setJsonError('Erro ao ler o arquivo.');
      setLoadingJson(false);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const filteredProvas = provasList.filter((p) => {
    if (banca && (p.banca || '').toLowerCase() !== banca.toLowerCase()) return false;
    if (regiao && (p.regiao || '') !== regiao) return false;
    if (ano && (p.ano || '') !== ano) return false;
    if (tipo && (p.tipo || '').toLowerCase() !== tipo.toLowerCase()) return false;
    return true;
  });

  const handleRealizarProva = (prova: Prova) => {
    setProvaEmAndamento(prova);
    setExamIndex(0);
    setExamAnswers({});
    setShowExamResults(false);
  };

  const examQuestions = provaEmAndamento?.questions ?? [];
  const currentQuestion = examQuestions[examIndex];
  const totalExam = examQuestions.length;

  const handleExamAnswer = (letter: string) => {
    if (!currentQuestion) return;
    setExamAnswers((prev) => ({ ...prev, [currentQuestion.id]: letter }));
  };

  const handleExamNext = () => {
    if (examIndex < totalExam - 1) setExamIndex((i) => i + 1);
    else setShowExamResults(true);
  };

  const handleExamPrev = () => {
    if (examIndex > 0) setExamIndex((i) => i - 1);
  };

  const correctCount = provaEmAndamento
    ? provaEmAndamento.questions.filter((q) => examAnswers[q.id] === q.correct_answer).length
    : 0;
  const percent = totalExam ? Math.round((correctCount / totalExam) * 100) : 0;

  const getOptionValue = (q: ProvaQuestion, key: string) => {
    const map: Record<string, string> = {
      A: q.option_a,
      B: q.option_b,
      C: q.option_c || '',
      D: q.option_d || '',
      E: q.option_e || '',
    };
    return map[key] || '';
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-gray-800">Provas na Íntegra</h1>
        <p className="text-gray-600 mt-1">
          Acesse provas completas para estudo e prática. Faça upload de um JSON para criar provas e questões.
        </p>
      </header>

      {/* Banner de sessão expirada */}
      {sessionExpired && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
          <LogIn className="w-5 h-5 flex-shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold">Sessão expirada</p>
            <p className="text-sm mt-0.5">Sua sessão expirou. Faça login novamente para continuar.</p>
          </div>
          <Link
            href="/login"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium transition"
          >
            <LogIn className="w-4 h-4" />
            Ir para login
          </Link>
        </div>
      )}

      {/* Feedback de importação bem-sucedida */}
      {importSummary && (
        <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
          <div>
            <p className="font-semibold">Importação concluída!</p>
            <p className="text-sm mt-1">
              {importSummary.provasImportadas > 0
                ? <><strong>{importSummary.provasImportadas}</strong> prova(s) e <strong>{importSummary.questoesImportadas}</strong> questão(ões) importadas.</>
                : 'Nenhuma prova nova importada.'}{' '}
              {importSummary.provasIgnoradas > 0 && (
                <span className="text-green-700">
                  <strong>{importSummary.provasIgnoradas}</strong> prova(s) já existiam e foram ignoradas (sem duplicatas).
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setImportSummary(null)}
            className="ml-auto p-1 text-green-600 hover:text-green-800 rounded"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setFiltrosAbertos((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left font-medium text-gray-800 hover:bg-gray-50 transition"
          aria-expanded={filtrosAbertos}
        >
          <span className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-gray-500" />
            Filtros
          </span>
          {filtrosAbertos ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
        </button>
        {filtrosAbertos && (
          <div className="border-t border-gray-200 p-4 bg-gray-50/50">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Banca — populada dinamicamente dos dados */}
              <div>
                <label htmlFor="filtro-banca" className="block text-sm font-medium text-gray-700 mb-1">Banca</label>
                <select
                  id="filtro-banca"
                  value={banca}
                  onChange={(e) => setBanca(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">Todas</option>
                  {bancasDisponiveis.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              {/* Região */}
              <div>
                <label htmlFor="filtro-regiao" className="block text-sm font-medium text-gray-700 mb-1">Região</label>
                <select
                  id="filtro-regiao"
                  value={regiao}
                  onChange={(e) => setRegiao(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">Todos os estados</option>
                  <option value="AC">Acre</option>
                  <option value="AL">Alagoas</option>
                  <option value="AP">Amapá</option>
                  <option value="AM">Amazonas</option>
                  <option value="BA">Bahia</option>
                  <option value="CE">Ceará</option>
                  <option value="DF">Distrito Federal</option>
                  <option value="ES">Espírito Santo</option>
                  <option value="GO">Goiás</option>
                  <option value="MA">Maranhão</option>
                  <option value="MT">Mato Grosso</option>
                  <option value="MS">Mato Grosso do Sul</option>
                  <option value="MG">Minas Gerais</option>
                  <option value="PA">Pará</option>
                  <option value="PB">Paraíba</option>
                  <option value="PR">Paraná</option>
                  <option value="PE">Pernambuco</option>
                  <option value="PI">Piauí</option>
                  <option value="RJ">Rio de Janeiro</option>
                  <option value="RN">Rio Grande do Norte</option>
                  <option value="RS">Rio Grande do Sul</option>
                  <option value="RO">Rondônia</option>
                  <option value="RR">Roraima</option>
                  <option value="SC">Santa Catarina</option>
                  <option value="SP">São Paulo</option>
                  <option value="SE">Sergipe</option>
                  <option value="TO">Tocantins</option>
                </select>
              </div>

              {/* Ano — de 1990 ao ano atual */}
              <div>
                <label htmlFor="filtro-ano" className="block text-sm font-medium text-gray-700 mb-1">Ano</label>
                <select
                  id="filtro-ano"
                  value={ano}
                  onChange={(e) => setAno(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">Todos</option>
                  {ANOS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              {/* Tipo — populado dinamicamente dos dados */}
              <div>
                <label htmlFor="filtro-tipo" className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  id="filtro-tipo"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">Todos</option>
                  {tiposDisponiveis.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {(banca || regiao || ano || tipo) && (
              <button
                type="button"
                onClick={() => { setBanca(''); setRegiao(''); setAno(''); setTipo(''); }}
                className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Botão importar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
          <p className="text-gray-500">
            Selecione um arquivo JSON para importar provas e questões. Provas com o mesmo nome serão ignoradas automaticamente.
          </p>
          <button
            type="button"
            onClick={handleAbrirSelecao}
            disabled={loadingJson}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium text-sm whitespace-nowrap"
          >
            {loadingJson ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderOpen className="w-5 h-5" />}
            {loadingJson ? 'Importando...' : 'Importar JSON de provas'}
          </button>
        </div>
        {jsonError && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{jsonError}</div>
        )}
      </div>

      {/* Lista de provas */}
      {loadingProvas ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          <p className="text-gray-600 mt-2">Carregando provas...</p>
        </div>
      ) : filteredProvas.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          {provasList.length === 0
            ? 'Nenhuma prova encontrada. Importe um JSON com provas para começar.'
            : 'Nenhuma prova encontrada com os filtros selecionados.'}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredProvas.map((prova) => (
            <div key={prova.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-gray-800">{prova.nome}</h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  {prova.banca && <span className="px-2 py-1 bg-white rounded border border-gray-200">Banca: {prova.banca}</span>}
                  {prova.regiao && <span className="px-2 py-1 bg-white rounded border border-gray-200">Região: {prova.regiao}</span>}
                  {prova.ano && <span className="px-2 py-1 bg-white rounded border border-gray-200">Ano: {prova.ano}</span>}
                  {prova.tipo && <span className="px-2 py-1 bg-white rounded border border-gray-200">Tipo: {prova.tipo}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => handleRealizarProva(prova)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium text-sm"
                >
                  <Play className="w-4 h-4" />
                  Realizar prova
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm font-medium text-gray-700">Questões da prova ({prova.questions.length})</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {prova.questions
                    .sort((a, b) => (a.numero_na_prova ?? 0) - (b.numero_na_prova ?? 0))
                    .map((q) => (
                      <div
                        key={q.id}
                        className={`rounded-lg border p-4 hover:shadow-sm transition ${
                          q.anulada
                            ? 'bg-red-50/40 border-red-200'
                            : 'bg-gray-50 border-gray-200'
                        }`}
                      >
                        {q.anulada && (
                          <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-red-700">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            QUESTÃO ANULADA — Indisponível para simulados
                          </div>
                        )}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">
                              Questão {q.numero_na_prova ?? '—'} (ID #{q.id})
                            </span>
                            {q.anulada && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                                <Ban className="w-2.5 h-2.5" />
                                ANULADA
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 text-xs text-gray-500">
                            {q.exam_board && <span>Banca: {q.exam_board}</span>}
                            {q.exam_region && <span>| {q.exam_region}</span>}
                            {q.exam_year && <span>| {q.exam_year}</span>}
                            {q.exam_type && <span>| {q.exam_type}</span>}
                          </div>
                        </div>
                        <p className="text-gray-700 text-sm line-clamp-3">{q.statement}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {q.option_a && <span className="text-xs text-gray-500">A) {q.option_a.slice(0, 40)}…</span>}
                          {q.option_b && <span className="text-xs text-gray-500">B) {q.option_b.slice(0, 40)}…</span>}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal seleção de arquivo */}
      {showFileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Selecionar arquivo JSON</h2>
              <button
                type="button"
                onClick={() => setShowFileModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Formatos aceitos: <strong>array de questões</strong>, objeto com <strong>provas</strong> ou <strong>paginas</strong> (crawler antigo).
              </p>
              <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
                Provas com o mesmo nome serão ignoradas (sem duplicatas). Arquivos grandes são importados automaticamente em lotes.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
                aria-hidden
              />
              <button
                type="button"
                onClick={handleEscolherArquivo}
                disabled={loadingJson}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-700 hover:border-primary-500 hover:bg-primary-50 transition font-medium text-sm disabled:opacity-60"
              >
                {loadingJson
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> {importProgress ? `Importando lote ${importProgress.current}/${importProgress.total}...` : 'Processando...'}</>
                  : <><FolderOpen className="w-5 h-5" /> Explorar e escolher arquivo</>
                }
              </button>
              {loadingJson && importProgress && (
                <div className="space-y-1">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-center">
                    Lote {importProgress.current} de {importProgress.total} — arquivos grandes são importados em partes
                  </p>
                </div>
              )}
              {jsonError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{jsonError}</div>
              )}
              {sessionExpired && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                  <LogIn className="w-4 h-4 flex-shrink-0 text-amber-600" />
                  <span>Sessão expirada.</span>
                  <Link href="/login" className="ml-auto font-semibold underline hover:text-amber-900">
                    Fazer login
                  </Link>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setShowFileModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition text-sm font-medium"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Realizar prova */}
      {provaEmAndamento && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">{provaEmAndamento.nome}</h2>
              <button
                type="button"
                onClick={() => { setProvaEmAndamento(null); setShowExamResults(false); }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {showExamResults ? (
                <div className="text-center py-6">
                  <p className="text-2xl font-bold text-primary-600">{percent}%</p>
                  <p className="text-gray-600 mt-1">{correctCount} de {totalExam} questões corretas</p>
                  <div className="flex justify-center gap-4 mt-4 text-sm">
                    <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-4 h-4" /> {correctCount} corretas</span>
                    <span className="flex items-center gap-1 text-red-600"><XCircle className="w-4 h-4" /> {totalExam - correctCount} incorretas</span>
                  </div>
                </div>
              ) : currentQuestion ? (
                <>
                  {currentQuestion.anulada && (
                    <div className="flex items-start gap-2 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-semibold">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      Questão anulada — esta questão não está disponível para simulados.
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-4 text-sm text-gray-500">
                    <span className="flex items-center gap-2">
                      Questão {currentQuestion.numero_na_prova ?? examIndex + 1} (ID #{currentQuestion.id})
                      {currentQuestion.anulada && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                          <Ban className="w-3 h-3" />
                          ANULADA
                        </span>
                      )}
                    </span>
                    <span>
                      Banca: {currentQuestion.exam_board || '—'} | Região: {currentQuestion.exam_region || '—'} | Ano: {currentQuestion.exam_year || '—'} | Tipo: {currentQuestion.exam_type || '—'}
                    </span>
                  </div>
                  <p className="text-gray-800 mb-4 whitespace-pre-wrap">{currentQuestion.statement}</p>
                  <div className="space-y-2">
                    {['A', 'B', 'C', 'D', 'E'].map((key) => {
                      const val = getOptionValue(currentQuestion, key);
                      if (!val) return null;
                      const selected = examAnswers[currentQuestion.id] === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleExamAnswer(key)}
                          className={`w-full text-left p-3 rounded-lg border-2 transition ${
                            selected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          <span className="font-semibold text-gray-700">{key})</span>{' '}
                          <span className="text-gray-800">{val}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
            {!showExamResults && totalExam > 0 && (
              <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <button
                  type="button"
                  onClick={handleExamPrev}
                  disabled={examIndex === 0}
                  className="flex items-center gap-1 px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" /> Anterior
                </button>
                <span className="text-sm text-gray-600">{examIndex + 1} de {totalExam}</span>
                <button
                  type="button"
                  onClick={handleExamNext}
                  className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                >
                  {examIndex >= totalExam - 1 ? 'Finalizar' : 'Próxima'} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
            {showExamResults && (
              <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end">
                <button
                  type="button"
                  onClick={() => { setProvaEmAndamento(null); setShowExamResults(false); }}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                >
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
