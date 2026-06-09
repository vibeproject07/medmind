'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Filter, FolderOpen, Loader2, X, Play, CheckCircle, LogIn } from 'lucide-react';
import { jsonrepair } from 'jsonrepair';

interface ProvaListing {
  id: number;
  nome: string;
  banca: string | null;
  regiao: string | null;
  ano: string | null;
  tipo: string | null;
  created_at: string;
  question_count: number;
}

interface ListingResponse {
  provas: ProvaListing[];
  total: number;
  page: number;
  totalPages: number;
  bancas: string[];
  tipos: string[];
}

interface ImportSummary {
  provasImportadas: number;
  provasIgnoradas: number;
  questoesImportadas: number;
  provasComErro: number;
  erros: { nome: string; reason: string }[];
}

const ANO_INICIO = 1990;
const ANO_FIM = new Date().getFullYear();
const ANOS = Array.from({ length: ANO_FIM - ANO_INICIO + 1 }, (_, i) => String(ANO_FIM - i));
const PAGE_SIZE = 20;

export default function ProvasPage() {
  const router = useRouter();

  // ── Filters & pagination ────────────────────────────────────────────────
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [banca, setBanca] = useState('');
  const [regiao, setRegiao] = useState('');
  const [ano, setAno] = useState('');
  const [tipo, setTipo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // ── Data ────────────────────────────────────────────────────────────────
  const [provasList, setProvasList] = useState<ProvaListing[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [bancasDisponiveis, setBancasDisponiveis] = useState<string[]>([]);
  const [tiposDisponiveis, setTiposDisponiveis] = useState<string[]>([]);
  const [loadingProvas, setLoadingProvas] = useState(true);

  // ── UI states ───────────────────────────────────────────────────────────
  const [sessionExpired, setSessionExpired] = useState(false);
  const [showFileModal, setShowFileModal] = useState(false);
  const [loadingJson, setLoadingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  // Per-card loading state when fetching questions before navigating
  const [realizandoProvaId, setRealizandoProvaId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch listing ────────────────────────────────────────────────────────
  const fetchProvas = useCallback(async (page: number) => {
    const token = localStorage.getItem('token');
    if (!token) { setLoadingProvas(false); return; }
    setLoadingProvas(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(banca  ? { banca }  : {}),
        ...(regiao ? { regiao } : {}),
        ...(ano    ? { ano }    : {}),
        ...(tipo   ? { tipo }   : {}),
      });
      const res = await fetch(`/api/provas?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: ListingResponse = await res.json();
        setProvasList(data.provas ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 0);
        // Only update filter options on first load (page 1, no active filter)
        if (data.bancas) setBancasDisponiveis(data.bancas);
        if (data.tipos)  setTiposDisponiveis(data.tipos);
      } else if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProvas(false);
    }
  }, [banca, regiao, ano, tipo]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [banca, regiao, ano, tipo]);

  useEffect(() => {
    fetchProvas(currentPage);
  }, [fetchProvas, currentPage]);

  // ── Import handlers ──────────────────────────────────────────────────────
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
        const buffer = reader.result as ArrayBuffer;
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
          try {
            text = new TextDecoder('windows-1252').decode(buffer);
          } catch {
            setJsonError('Não foi possível decodificar o arquivo. Tente salvá-lo como UTF-8.');
            setLoadingJson(false);
            return;
          }
        }
        text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          try {
            parsed = JSON.parse(jsonrepair(text));
          } catch {
            setJsonError(
              'O arquivo não pôde ser lido. Arquivos do crawler web com encoding incorreto precisam de pré-processamento. ' +
              'Execute: python3 scripts/fix_crawler_json.py <arquivo.json> e importe o arquivo "_clean.json" gerado.'
            );
            setLoadingJson(false);
            return;
          }
        }

        const token = localStorage.getItem('token');
        if (!token) { setSessionExpired(true); setLoadingJson(false); return; }

        let data: Record<string, unknown>;
        if (Array.isArray(parsed)) {
          data = { provas: [{ nome: file.name.replace(/\.json$/i, ''), questoes: parsed }] };
        } else if (parsed && typeof parsed === 'object') {
          data = parsed as Record<string, unknown>;
        } else {
          setJsonError('Formato não reconhecido. O arquivo deve ser um JSON com provas ou um array de questões.');
          setLoadingJson(false);
          return;
        }

        if (!Array.isArray(data.provas) && !Array.isArray(data.paginas)) {
          const questoesKey = Array.isArray(data.questoes) ? 'questoes' : (Array.isArray(data.questions) ? 'questions' : null);
          if (questoesKey) {
            const todasQuestoes = data[questoesKey] as { numero?: number; [key: string]: unknown }[];
            if (data.titulo_prova && Array.isArray(data.arquivos) && (data.arquivos as unknown[]).length > 0) {
              const arquivos = data.arquivos as string[];
              const grupos: { numero?: number; [key: string]: unknown }[][] = [];
              let grupo: typeof todasQuestoes = [];
              for (const q of todasQuestoes) {
                const num = typeof q.numero === 'number' ? q.numero : parseInt(String(q.numero ?? '0'), 10);
                if (num === 1 && grupo.length > 0) { grupos.push(grupo); grupo = []; }
                grupo.push(q);
              }
              if (grupo.length > 0) grupos.push(grupo);
              const provas = grupos.map((questoes, i) => {
                const nomeArquivo = arquivos[i] ? String(arquivos[i]).replace(/\.pdf$/i, '').trim() : `Prova ${i + 1}`;
                return { nome: nomeArquivo, questoes };
              });
              data = { provas };
            } else {
              let nomeParte = file.name.replace(/\.json$/i, '');
              let metadados: Record<string, unknown> = {};
              if (data.titulo_prova && typeof data.titulo_prova === 'object') {
                const tp = data.titulo_prova as Record<string, unknown>;
                const b = String(tp.banca ?? '').trim();
                const r = String(tp.regiao ?? '').trim();
                const a = String(tp.ano ?? '').trim();
                const t = String(tp.tipo ?? '').trim();
                const partes = [b, r, a, t].filter(s => s.length > 0);
                if (partes.length > 0) nomeParte = partes.join(' - ');
                metadados = { banca: b || null, regiao: r || null, ano: a || null, tipo: t || null };
              }
              data = { provas: [{ nome: nomeParte, questoes: todasQuestoes, ...metadados }] };
            }
          }
        }

        const hasProvas  = Array.isArray(data.provas)  && (data.provas  as unknown[]).length > 0;
        const hasPaginas = Array.isArray(data.paginas) && (data.paginas as unknown[]).length > 0;
        if (!hasProvas && !hasPaginas) {
          const foundKeys = Object.keys(data).slice(0, 5).join('", "');
          setJsonError(`Formato não reconhecido. Chaves encontradas: "${foundKeys}". O arquivo deve conter uma chave "provas", "paginas", "questoes" ou ser um array de questões.`);
          setLoadingJson(false);
          return;
        }

        const BATCH_SIZE = 10;
        let totalImportadas = 0;
        let totalIgnoradas = 0;
        let totalQuestoes = 0;
        let totalComErro = 0;
        const todosErros: { nome: string; reason: string }[] = [];

        const runBatches = async (items: unknown[], batchSize: number, key: string) => {
          const batches: unknown[][] = [];
          for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));
          setImportProgress({ current: 0, total: batches.length });
          for (let i = 0; i < batches.length; i++) {
            setImportProgress({ current: i + 1, total: batches.length });
            const res = await fetch('/api/provas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ [key]: batches[i] }),
            });
            const body = await res.json();
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) { setSessionExpired(true); return false; }
              // Partial failure with saved provas — show as warning, not fatal error
              if (body.summary) {
                totalImportadas += body.summary.provasImportadas ?? 0;
                totalIgnoradas  += body.summary.provasIgnoradas  ?? 0;
                totalQuestoes   += body.summary.questoesImportadas ?? 0;
                totalComErro    += body.summary.provasComErro ?? 0;
                if (Array.isArray(body.errors)) todosErros.push(...body.errors);
              } else {
                setJsonError(body.error || 'Erro ao importar lote.');
                setLoadingJson(false);
                setImportProgress(null);
                return false;
              }
              continue;
            }
            totalImportadas += body.summary?.provasImportadas ?? 0;
            totalIgnoradas  += body.summary?.provasIgnoradas  ?? 0;
            totalQuestoes   += body.summary?.questoesImportadas ?? 0;
            totalComErro    += body.summary?.provasComErro ?? 0;
            if (Array.isArray(body.errors)) todosErros.push(...body.errors);
          }
          return true;
        };

        const ok = hasProvas
          ? await runBatches(data.provas as unknown[], BATCH_SIZE, 'provas')
          : await runBatches(data.paginas as unknown[], BATCH_SIZE * 4, 'paginas');

        if (!ok) return;

        setImportProgress(null);
        setShowFileModal(false);
        setImportSummary({ provasImportadas: totalImportadas, provasIgnoradas: totalIgnoradas, questoesImportadas: totalQuestoes, provasComErro: totalComErro, erros: todosErros });
        await fetchProvas(1);
        setCurrentPage(1);
      } catch (err) {
        console.error('Erro na importação:', err);
        setJsonError('Ocorreu um erro ao processar o arquivo. Verifique se é um JSON válido.');
      } finally {
        setLoadingJson(false);
        setImportProgress(null);
      }
    };
    reader.onerror = () => { setJsonError('Erro ao ler o arquivo.'); setLoadingJson(false); };
    reader.readAsArrayBuffer(file);
  };

  // ── Realizar prova — fetch full questions on demand ──────────────────────
  const handleRealizarProva = async (provaId: number) => {
    const token = localStorage.getItem('token');
    if (!token) { setSessionExpired(true); return; }
    setRealizandoProvaId(provaId);
    try {
      const res = await fetch(`/api/provas/${provaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const prova = await res.json();
        localStorage.setItem(`examProva_${provaId}`, JSON.stringify(prova));
        router.push(`/dashboard/provas/${provaId}`);
      } else if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
      }
    } catch (err) {
      console.error('Erro ao carregar prova:', err);
    } finally {
      setRealizandoProvaId(null);
    }
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

      {/* Feedback de importação */}
      {importSummary && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${importSummary.provasComErro > 0 && importSummary.provasImportadas === 0 ? 'bg-red-50 border-red-200 text-red-800' : importSummary.provasComErro > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          <CheckCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${importSummary.provasComErro > 0 && importSummary.provasImportadas === 0 ? 'text-red-500' : importSummary.provasComErro > 0 ? 'text-amber-500' : 'text-green-600'}`} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">
              {importSummary.provasComErro > 0 && importSummary.provasImportadas === 0
                ? 'Nenhuma prova foi importada'
                : importSummary.provasComErro > 0
                ? 'Importação parcialmente concluída'
                : 'Importação concluída!'}
            </p>
            <ul className="text-sm mt-1 space-y-0.5">
              <li>
                <strong>{importSummary.provasImportadas}</strong> prova(s) novas adicionadas
                {importSummary.provasImportadas > 0 && <> ({importSummary.questoesImportadas} questão(ões))</>}.
              </li>
              <li>
                <strong>{importSummary.provasIgnoradas}</strong> prova(s) já existiam e foram ignoradas.
              </li>
              {importSummary.provasComErro > 0 && (
                <li>
                  <strong>{importSummary.provasComErro}</strong> prova(s) não puderam ser processadas.
                </li>
              )}
            </ul>
            {importSummary.erros.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {importSummary.erros.map((e, i) => (
                  <li key={i} className="text-xs opacity-80 truncate">
                    <strong>{e.nome}</strong>: {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setImportSummary(null)}
            className="ml-auto p-1 rounded opacity-60 hover:opacity-100 transition"
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
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
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
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{jsonError}</div>
        )}
      </div>

      {/* Lista de provas */}
      {loadingProvas ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          <p className="text-gray-600 mt-2">Carregando provas...</p>
        </div>
      ) : provasList.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          {total === 0 && !banca && !regiao && !ano && !tipo
            ? 'Nenhuma prova encontrada. Importe um JSON com provas para começar.'
            : 'Nenhuma prova encontrada com os filtros selecionados.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {provasList.map((prova) => (
              <div key={prova.id} className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
                <div className="p-5 flex-1 flex flex-col gap-3">
                  <h2 className="text-base font-semibold text-gray-800 leading-snug">{prova.nome}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {prova.banca && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 text-xs font-medium">
                        {prova.banca}
                      </span>
                    )}
                    {prova.regiao && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                        {prova.regiao}
                      </span>
                    )}
                    {prova.ano && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                        {prova.ano}
                      </span>
                    )}
                    {prova.tipo && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                        {prova.tipo}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-auto">
                    {prova.question_count} {prova.question_count === 1 ? 'questão' : 'questões'}
                  </p>
                </div>
                <div className="px-5 pb-5">
                  <button
                    type="button"
                    onClick={() => handleRealizarProva(prova.id)}
                    disabled={realizandoProvaId === prova.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-70 disabled:cursor-not-allowed transition font-medium text-sm"
                  >
                    {realizandoProvaId === prova.id
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</>
                      : <><Play className="w-4 h-4" /> Realizar prova</>
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 flex-wrap mt-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loadingProvas}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Anterior
              </button>
              <span className="px-4 py-2 text-sm text-gray-600">
                Página {currentPage} de {totalPages}
                {total > 0 && <span className="text-gray-400 ml-1">({total} provas)</span>}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loadingProvas}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Próxima
              </button>
            </div>
          )}
        </>
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
                Formatos aceitos: <strong>array de questões</strong>, objeto com chave <strong>provas</strong>, <strong>questoes</strong> ou <strong>paginas</strong> (crawler antigo).
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
