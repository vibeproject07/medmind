'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Filter, FolderOpen, Loader2, X, Play, ChevronLeft, ChevronRight, CheckCircle, XCircle } from 'lucide-react';

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

export default function ProvasPage() {
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [banca, setBanca] = useState('');
  const [regiao, setRegiao] = useState('');
  const [ano, setAno] = useState('');
  const [tipo, setTipo] = useState('');
  const [showFileModal, setShowFileModal] = useState(false);
  const [loadingJson, setLoadingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [provasList, setProvasList] = useState<Prova[]>([]);
  const [loadingProvas, setLoadingProvas] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [provaEmAndamento, setProvaEmAndamento] = useState<Prova | null>(null);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [showExamResults, setShowExamResults] = useState(false);

  const fetchProvas = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch('/api/provas', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setProvasList(Array.isArray(data) ? data : []);
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

  const handleAbrirSelecao = () => {
    setJsonError(null);
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
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result as string;
        const data = JSON.parse(text);
        const hasProvas = Array.isArray(data.provas) && data.provas.length > 0;
        const hasPaginas = Array.isArray(data.paginas) && data.paginas.length > 0;
        if (!hasProvas && !hasPaginas) {
          setJsonError('O JSON deve conter um array "provas" ou "paginas" (formato antigo) com ao menos um item.');
          setLoadingJson(false);
          return;
        }
        const token = localStorage.getItem('token');
        if (!token) {
          setJsonError('Faça login para importar.');
          setLoadingJson(false);
          return;
        }
        const payload = hasProvas ? { provas: data.provas } : { paginas: data.paginas };
        const res = await fetch('/api/provas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) {
          setJsonError(body.error || 'Erro ao importar.');
          setLoadingJson(false);
          return;
        }
        setShowFileModal(false);
        await fetchProvas();
      } catch {
        setJsonError('O arquivo não é um JSON válido ou está no formato incorreto.');
      } finally {
        setLoadingJson(false);
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

  const correctCount = provaEmAndamento ? provaEmAndamento.questions.filter((q) => examAnswers[q.id] === q.correct_answer).length : 0;
  const percent = totalExam ? Math.round((correctCount / totalExam) * 100) : 0;

  const getOptionKey = (q: ProvaQuestion, idx: number) => {
    const keys = ['A', 'B', 'C', 'D', 'E'];
    return keys[idx];
  };
  const getOptionValue = (q: ProvaQuestion, key: string) => {
    const map: Record<string, string> = { A: q.option_a, B: q.option_b, C: q.option_c || '', D: q.option_d || '', E: q.option_e || '' };
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
              <div>
                <label htmlFor="filtro-banca" className="block text-sm font-medium text-gray-700 mb-1">Banca</label>
                <select id="filtro-banca" value={banca} onChange={(e) => setBanca(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                  <option value="">Todas</option>
                  <option value="abc">ABC</option>
                  <option value="cfm">CFM</option>
                  <option value="outras">Outras</option>
                </select>
              </div>
              <div>
                <label htmlFor="filtro-regiao" className="block text-sm font-medium text-gray-700 mb-1">Região</label>
                <select id="filtro-regiao" value={regiao} onChange={(e) => setRegiao(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
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
              <div>
                <label htmlFor="filtro-ano" className="block text-sm font-medium text-gray-700 mb-1">Ano</label>
                <select id="filtro-ano" value={ano} onChange={(e) => setAno(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                  <option value="">Todos</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                  <option value="2022">2022</option>
                  <option value="2021">2021</option>
                  <option value="2020">2020</option>
                </select>
              </div>
              <div>
                <label htmlFor="filtro-tipo" className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select id="filtro-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                  <option value="">Todos</option>
                  <option value="r1">R1</option>
                  <option value="r2">R2</option>
                  <option value="r3">R3</option>
                  <option value="r4">R4</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
          <p className="text-gray-500">Selecione um arquivo JSON para importar provas e questões (formato: provas com nome, banca, regiao, ano, tipo e array de questões).</p>
          <button
            type="button"
            onClick={handleAbrirSelecao}
            disabled={loadingJson}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium text-sm"
          >
            {loadingJson ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderOpen className="w-5 h-5" />}
            {loadingJson ? 'Importando...' : 'Importar JSON de provas'}
          </button>
        </div>
        {jsonError && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{jsonError}</div>
        )}
      </div>

      {loadingProvas ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          <p className="text-gray-600 mt-2">Carregando provas...</p>
        </div>
      ) : filteredProvas.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          Nenhuma prova encontrada. Importe um JSON com provas para começar.
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
                        className="bg-gray-50 rounded-lg border border-gray-200 p-4 hover:shadow-sm transition"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-800">
                            Questão {q.numero_na_prova ?? '—'} (ID #{q.id})
                          </span>
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
              <button type="button" onClick={() => setShowFileModal(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Aceito: <strong>provas</strong> (nome, banca, regiao, ano, tipo, questoes) ou <strong>paginas</strong> (formato antigo do crawler). O nome é trimado e as categorias podem ser preenchidas pelo split com travessões.
              </p>
              <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileChange} className="hidden" aria-hidden />
              <button
                type="button"
                onClick={handleEscolherArquivo}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-700 hover:border-primary-500 hover:bg-primary-50 transition font-medium text-sm"
              >
                <FolderOpen className="w-5 h-5" />
                Explorar e escolher arquivo
              </button>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button type="button" onClick={() => setShowFileModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition text-sm font-medium">
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
                  <div className="flex items-center justify-between mb-4 text-sm text-gray-500">
                    <span>Questão {currentQuestion.numero_na_prova ?? examIndex + 1} (ID #{currentQuestion.id})</span>
                    <span>Banca: {currentQuestion.exam_board || '—'} | Região: {currentQuestion.exam_region || '—'} | Ano: {currentQuestion.exam_year || '—'} | Tipo: {currentQuestion.exam_type || '—'}</span>
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
                          <span className="font-semibold text-gray-700">{key})</span> <span className="text-gray-800">{val}</span>
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
