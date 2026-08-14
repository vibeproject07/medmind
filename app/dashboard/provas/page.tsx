'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Filter, FolderOpen, Loader2, X, Play, CheckCircle, LogIn, Eye, Edit, Save, Search, AlertTriangle, ImageIcon } from 'lucide-react';
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
  provas_criadas: number;
  provas_ja_existentes: number;
  provas_incompletas: number;
  provas_completas: number;
  provas_com_erro: number;
  questoes_inseridas: number;
  questoes_ja_existentes: number;
  questoes_atualizadas: number;
  questoes_faltando: number;
  questoes_esperadas: number;
  incompletas: {
    id: number;
    nome: string;
    esperado: number;
    atual: number;
    faltando: number;
    faltando_numeros?: number[];
  }[];
  erros: { nome: string; reason: string }[];
}

const ANO_INICIO = 1990;
const ANO_FIM = new Date().getFullYear();
const ANOS = Array.from({ length: ANO_FIM - ANO_INICIO + 1 }, (_, i) => String(ANO_FIM - i));
const PAGE_SIZE = 20;

const REGIOES_UF = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/** Remove null bytes (\u0000) recursivamente de qualquer valor JSON parseado. */
function sanitizeJsonNullBytes<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/\u0000/g, '') as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonNullBytes(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeJsonNullBytes(v);
    }
    return out as T;
  }
  return value;
}

interface ProvaEditForm {
  nome: string;
  banca: string;
  regiao: string;
  ano: string;
  tipo: string;
}

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

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminCrud, setShowAdminCrud] = useState(false);
  const [adminCrudPage, setAdminCrudPage] = useState(1);
  const [adminCrudList, setAdminCrudList] = useState<ProvaListing[]>([]);
  const [adminCrudTotal, setAdminCrudTotal] = useState(0);
  const [adminCrudTotalPages, setAdminCrudTotalPages] = useState(0);
  const [loadingAdminCrud, setLoadingAdminCrud] = useState(false);
  const [editingProvaId, setEditingProvaId] = useState<number | null>(null);
  const [editProvaForm, setEditProvaForm] = useState<ProvaEditForm>({
    nome: '', banca: '', regiao: '', ano: '', tipo: '',
  });
  const [savingProvaId, setSavingProvaId] = useState<number | null>(null);
  const [adminCrudMsg, setAdminCrudMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [adminCrudFiltrosAbertos, setAdminCrudFiltrosAbertos] = useState(true);
  const [adminCrudSearch, setAdminCrudSearch] = useState('');
  const [adminCrudSearchDebounced, setAdminCrudSearchDebounced] = useState('');
  const [adminCrudBanca, setAdminCrudBanca] = useState('');
  const [adminCrudRegiao, setAdminCrudRegiao] = useState('');
  const [adminCrudAno, setAdminCrudAno] = useState('');
  const [adminCrudTipo, setAdminCrudTipo] = useState('');
  const [adminCrudBancas, setAdminCrudBancas] = useState<string[]>([]);
  const [adminCrudTipos, setAdminCrudTipos] = useState<string[]>([]);

  // ── Prova Incompleta modal ───────────────────────────────────────────────
  type IncompleteStep = 'menu' | 'add' | 'remove';
  const [incompleteProva, setIncompleteProva] = useState<ProvaListing | null>(null);
  const [incompleteStep, setIncompleteStep] = useState<IncompleteStep>('menu');
  const [incompleteLoading, setIncompleteLoading] = useState(false);
  const [incompleteError, setIncompleteError] = useState<string | null>(null);
  const [incompleteMsg, setIncompleteMsg] = useState<string | null>(null);
  const [removeQuestions, setRemoveQuestions] = useState<{ id: number; numero_na_prova: number | null; statement: string }[]>([]);
  const [removeSelectedId, setRemoveSelectedId] = useState<number | null>(null);
  const [addForm, setAddForm] = useState({
    numero_na_prova: '1',
    statement: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    option_e: '',
    correct_answer: 'A' as 'A' | 'B' | 'C' | 'D' | 'E',
  });
  const [addImages, setAddImages] = useState<string[]>([]);
  const addImageInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setIsAdmin(payload.role === 'admin');
    } catch {
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setAdminCrudSearchDebounced(adminCrudSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [adminCrudSearch]);

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

  const fetchAdminCrudProvas = useCallback(async (page: number) => {
    const token = localStorage.getItem('token');
    if (!token) { setLoadingAdminCrud(false); return; }
    setLoadingAdminCrud(true);
    setAdminCrudMsg(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(adminCrudSearchDebounced ? { q: adminCrudSearchDebounced } : {}),
        ...(adminCrudBanca ? { banca: adminCrudBanca } : {}),
        ...(adminCrudRegiao ? { regiao: adminCrudRegiao } : {}),
        ...(adminCrudAno ? { ano: adminCrudAno } : {}),
        ...(adminCrudTipo ? { tipo: adminCrudTipo } : {}),
      });
      const res = await fetch(`/api/provas?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: ListingResponse = await res.json();
        setAdminCrudList(data.provas ?? []);
        setAdminCrudTotal(data.total ?? 0);
        setAdminCrudTotalPages(data.totalPages ?? 0);
        if (data.bancas) setAdminCrudBancas(data.bancas);
        if (data.tipos) setAdminCrudTipos(data.tipos);
      } else if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
      } else {
        const body = await res.json().catch(() => ({}));
        setAdminCrudMsg({ type: 'error', text: body.error || 'Erro ao carregar provas.' });
      }
    } catch (err) {
      console.error(err);
      setAdminCrudMsg({ type: 'error', text: 'Erro ao carregar provas.' });
    } finally {
      setLoadingAdminCrud(false);
    }
  }, [adminCrudSearchDebounced, adminCrudBanca, adminCrudRegiao, adminCrudAno, adminCrudTipo]);

  useEffect(() => {
    setAdminCrudPage(1);
  }, [adminCrudSearchDebounced, adminCrudBanca, adminCrudRegiao, adminCrudAno, adminCrudTipo]);

  useEffect(() => {
    if (showAdminCrud && isAdmin) {
      fetchAdminCrudProvas(adminCrudPage);
    }
  }, [showAdminCrud, isAdmin, adminCrudPage, fetchAdminCrudProvas]);

  const startEditProva = (prova: ProvaListing) => {
    setEditingProvaId(prova.id);
    setEditProvaForm({
      nome: prova.nome ?? '',
      banca: prova.banca ?? '',
      regiao: prova.regiao ?? '',
      ano: prova.ano ?? '',
      tipo: prova.tipo ?? '',
    });
    setAdminCrudMsg(null);
  };

  const cancelEditProva = () => {
    setEditingProvaId(null);
  };

  const saveEditProva = async (provaId: number) => {
    if (!editProvaForm.nome.trim()) {
      setAdminCrudMsg({ type: 'error', text: 'O nome da prova é obrigatório.' });
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;

    setSavingProvaId(provaId);
    setAdminCrudMsg(null);
    try {
      const res = await fetch(`/api/provas/${provaId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: editProvaForm.nome.trim(),
          banca: editProvaForm.banca.trim() || null,
          regiao: editProvaForm.regiao.trim() || null,
          ano: editProvaForm.ano.trim() || null,
          tipo: editProvaForm.tipo.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdminCrudMsg({ type: 'error', text: data.error || 'Erro ao salvar prova.' });
        return;
      }

      setAdminCrudList((prev) =>
        prev.map((p) =>
          p.id === provaId
            ? {
                ...p,
                nome: data.nome,
                banca: data.banca,
                regiao: data.regiao,
                ano: data.ano,
                tipo: data.tipo,
                question_count: data.question_count ?? p.question_count,
              }
            : p,
        ),
      );
      setEditingProvaId(null);
      setAdminCrudMsg({ type: 'success', text: 'Prova atualizada com sucesso.' });
      fetchProvas(currentPage);
    } catch {
      setAdminCrudMsg({ type: 'error', text: 'Erro ao salvar prova.' });
    } finally {
      setSavingProvaId(null);
    }
  };

  const handleToggleAdminCrud = () => {
    setShowAdminCrud((prev) => {
      const next = !prev;
      if (next) {
        setAdminCrudPage(1);
        setEditingProvaId(null);
        setAdminCrudMsg(null);
      } else {
        setAdminCrudSearch('');
        setAdminCrudSearchDebounced('');
        setAdminCrudBanca('');
        setAdminCrudRegiao('');
        setAdminCrudAno('');
        setAdminCrudTipo('');
      }
      return next;
    });
  };

  const adminCrudHasFilters = !!(adminCrudSearch.trim() || adminCrudBanca || adminCrudRegiao || adminCrudAno || adminCrudTipo);

  const clearAdminCrudFilters = () => {
    setAdminCrudSearch('');
    setAdminCrudBanca('');
    setAdminCrudRegiao('');
    setAdminCrudAno('');
    setAdminCrudTipo('');
  };

  // ── Modal Prova Incompleta ───────────────────────────────────────────────
  const closeIncompleteModal = () => {
    setIncompleteProva(null);
    setIncompleteStep('menu');
    setIncompleteError(null);
    setIncompleteMsg(null);
    setRemoveQuestions([]);
    setRemoveSelectedId(null);
    setAddImages([]);
    setIncompleteLoading(false);
  };

  const openIncompleteModal = (prova: ProvaListing) => {
    setIncompleteProva(prova);
    setIncompleteStep('menu');
    setIncompleteError(null);
    setIncompleteMsg(null);
    setRemoveQuestions([]);
    setRemoveSelectedId(null);
    setAddForm({
      numero_na_prova: String(Math.max(1, (prova.question_count ?? 0) + 1)),
      statement: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'A',
    });
    setAddImages([]);
  };

  const addAvailableOptions: Array<'A' | 'B' | 'C' | 'D' | 'E'> = [
    'A',
    'B',
    ...(addForm.option_c.trim() ? (['C'] as const) : []),
    ...(addForm.option_d.trim() ? (['D'] as const) : []),
    ...(addForm.option_e.trim() ? (['E'] as const) : []),
  ];

  const handleAddImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        alert('Apenas arquivos de imagem são permitidos');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        setAddImages((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });
    if (addImageInputRef.current) addImageInputRef.current.value = '';
  };

  const startRemoveStep = async () => {
    if (!incompleteProva) return;
    setIncompleteStep('remove');
    setIncompleteError(null);
    setIncompleteMsg(null);
    setIncompleteLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/provas/${incompleteProva.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setIncompleteError(data.error || 'Erro ao carregar questões.');
        return;
      }
      const qs = (data.questions ?? []).map((q: { id: number; numero_na_prova: number | null; statement: string }) => ({
        id: q.id,
        numero_na_prova: q.numero_na_prova,
        statement: q.statement,
      }));
      setRemoveQuestions(qs);
      setRemoveSelectedId(qs[0]?.id ?? null);
    } catch {
      setIncompleteError('Erro ao carregar questões.');
    } finally {
      setIncompleteLoading(false);
    }
  };

  const submitAddQuestion = async () => {
    if (!incompleteProva) return;
    if (!addForm.statement.trim() || !addForm.option_a.trim() || !addForm.option_b.trim()) {
      setIncompleteError('Enunciado e alternativas A/B são obrigatórios.');
      return;
    }
    if (!addAvailableOptions.includes(addForm.correct_answer)) {
      setIncompleteError('Resposta correta deve corresponder a uma alternativa preenchida.');
      return;
    }
    const numero = parseInt(addForm.numero_na_prova, 10);
    if (isNaN(numero) || numero < 1) {
      setIncompleteError('Informe a posição (número) da questão na prova (≥ 1).');
      return;
    }

    setIncompleteLoading(true);
    setIncompleteError(null);
    setIncompleteMsg(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/provas/${incompleteProva.id}/questions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          numero_na_prova: numero,
          statement: addForm.statement.trim(),
          option_a: addForm.option_a.trim(),
          option_b: addForm.option_b.trim(),
          option_c: addForm.option_c.trim() || null,
          option_d: addForm.option_d.trim() || null,
          option_e: addForm.option_e.trim() || null,
          correct_answer: addForm.correct_answer,
          images: addImages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIncompleteError(data.error || 'Erro ao adicionar questão.');
        return;
      }
      setIncompleteMsg(`Questão adicionada na posição ${data.numero_na_prova}. As posteriores foram renumeradas (+1).`);
      fetchProvas(currentPage);
      if (showAdminCrud) fetchAdminCrudProvas(adminCrudPage);
      setTimeout(() => closeIncompleteModal(), 1200);
    } catch {
      setIncompleteError('Erro ao adicionar questão.');
    } finally {
      setIncompleteLoading(false);
    }
  };

  const submitRemoveQuestion = async () => {
    if (!incompleteProva || !removeSelectedId) {
      setIncompleteError('Selecione a questão a remover da prova.');
      return;
    }
    if (!confirm('Remover esta questão da prova? Ela não será apagada do banco — irá para a lista oculta de removidas.')) {
      return;
    }

    setIncompleteLoading(true);
    setIncompleteError(null);
    setIncompleteMsg(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/provas/${incompleteProva.id}/questions/remove`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question_id: removeSelectedId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIncompleteError(data.error || 'Erro ao remover questão.');
        return;
      }
      setIncompleteMsg('Questão removida da prova e enviada à lista oculta. Posteriores renumeradas (−1).');
      fetchProvas(currentPage);
      if (showAdminCrud) fetchAdminCrudProvas(adminCrudPage);
      setTimeout(() => closeIncompleteModal(), 1200);
    } catch {
      setIncompleteError('Erro ao remover questão.');
    } finally {
      setIncompleteLoading(false);
    }
  };

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
        parsed = sanitizeJsonNullBytes(parsed);

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
        let provasCriadas = 0;
        let provasJaExistentes = 0;
        let provasIncompletas = 0;
        let provasCompletas = 0;
        let provasComErro = 0;
        let questoesInseridas = 0;
        let questoesJaExistentes = 0;
        let questoesAtualizadas = 0;
        let questoesFaltando = 0;
        let questoesEsperadas = 0;
        const todosErros: { nome: string; reason: string }[] = [];
        const todasIncompletas: ImportSummary['incompletas'] = [];

        const mergeSummary = (body: Record<string, unknown>) => {
          const s = (body.summary ?? {}) as Record<string, number>;
          provasCriadas += s.provas_criadas ?? s.provasImportadas ?? 0;
          provasJaExistentes += s.provas_ja_existentes ?? s.provasIgnoradas ?? 0;
          provasIncompletas += s.provas_incompletas ?? 0;
          provasCompletas += s.provas_completas ?? 0;
          provasComErro += s.provas_com_erro ?? s.provasComErro ?? 0;
          questoesInseridas += s.questoes_inseridas ?? s.questoesImportadas ?? 0;
          questoesJaExistentes += s.questoes_ja_existentes ?? 0;
          questoesAtualizadas += s.questoes_atualizadas ?? 0;
          questoesFaltando += s.questoes_faltando ?? 0;
          questoesEsperadas += s.questoes_esperadas ?? 0;
          if (Array.isArray(body.errors)) {
            todosErros.push(...(body.errors as { nome: string; reason: string }[]));
          }
          if (Array.isArray(body.provas_incompletas)) {
            todasIncompletas.push(
              ...(body.provas_incompletas as ImportSummary['incompletas']),
            );
          }
        };

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
            if (!res.ok && !body.summary) {
              if (res.status === 401 || res.status === 403) { setSessionExpired(true); return false; }
              setJsonError(body.error || 'Erro ao importar lote.');
              setLoadingJson(false);
              setImportProgress(null);
              return false;
            }
            if (res.status === 401 || res.status === 403) { setSessionExpired(true); return false; }
            mergeSummary(body);
          }
          return true;
        };

        const ok = hasProvas
          ? await runBatches(data.provas as unknown[], BATCH_SIZE, 'provas')
          : await runBatches(data.paginas as unknown[], BATCH_SIZE * 4, 'paginas');

        if (!ok) return;

        setImportProgress(null);
        setShowFileModal(false);
        setImportSummary({
          provas_criadas: provasCriadas,
          provas_ja_existentes: provasJaExistentes,
          provas_incompletas: provasIncompletas || todasIncompletas.length,
          provas_completas: provasCompletas,
          provas_com_erro: provasComErro,
          questoes_inseridas: questoesInseridas,
          questoes_ja_existentes: questoesJaExistentes,
          questoes_atualizadas: questoesAtualizadas,
          questoes_faltando: questoesFaltando,
          questoes_esperadas: questoesEsperadas,
          incompletas: todasIncompletas,
          erros: todosErros,
        });
        await fetchProvas(1);
        setCurrentPage(1);
        setAdminCrudPage(1);
        fetchAdminCrudProvas(1);
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

  // ── Realizar prova — navega; a página da prova carrega via API (não depende do localStorage)
  const [realizarError, setRealizarError] = useState<string | null>(null);

  const handleRealizarProva = async (provaId: number) => {
    const token = localStorage.getItem('token');
    if (!token) { setSessionExpired(true); return; }
    setRealizandoProvaId(provaId);
    setRealizarError(null);
    try {
      // Limpa cache antigo (pode estar corrompido / estourado)
      try { localStorage.removeItem(`examProva_${provaId}`); } catch { /* ignore */ }

      const res = await fetch(`/api/provas/${provaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRealizarError(
          (data as { error?: string }).error ||
            `Não foi possível carregar a prova (HTTP ${res.status}).`,
        );
        return;
      }
      const prova = await res.json();
      // Cache leve sem imagens — a página busca a prova completa na API
      try {
        const light = {
          ...prova,
          questions: (prova.questions ?? []).map((q: { images?: string[] }) => ({
            ...q,
            images: [],
          })),
        };
        localStorage.setItem(`examProva_${provaId}`, JSON.stringify(light));
      } catch {
        /* QuotaExceeded — navegamos mesmo assim; a página usa a API */
      }
      router.push(`/dashboard/provas/${provaId}`);
    } catch (err) {
      console.error('Erro ao carregar prova:', err);
      setRealizarError('Erro de rede ao carregar a prova. Tente novamente.');
    } finally {
      setRealizandoProvaId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Provas na Íntegra</h1>
          <p className="text-gray-600 mt-1">
            Acesse provas completas para estudo e prática. Faça upload de um JSON para criar provas e questões.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={handleToggleAdminCrud}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition font-medium text-sm whitespace-nowrap flex-shrink-0 ${
              showAdminCrud
                ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
            }`}
          >
            {showAdminCrud ? (
              <><X className="w-4 h-4" /> Fechar gestão</>
            ) : (
              <><Eye className="w-4 h-4" /> Ver Provas</>
            )}
          </button>
        )}
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

      {realizarError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Não foi possível abrir a prova</p>
            <p className="text-sm mt-0.5">{realizarError}</p>
          </div>
          <button
            type="button"
            onClick={() => setRealizarError(null)}
            className="p-1 text-red-500 hover:bg-red-100 rounded"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Feedback de importação */}
      {importSummary && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${
          importSummary.provas_com_erro > 0 && importSummary.provas_criadas === 0 && importSummary.questoes_inseridas === 0
            ? 'bg-red-50 border-red-200 text-red-800'
            : importSummary.provas_incompletas > 0 || importSummary.provas_com_erro > 0 || importSummary.questoes_faltando > 0
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-green-50 border-green-200 text-green-800'
        }`}>
          <CheckCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
            importSummary.provas_com_erro > 0 && importSummary.questoes_inseridas === 0
              ? 'text-red-500'
              : importSummary.provas_incompletas > 0 || importSummary.provas_com_erro > 0
                ? 'text-amber-500'
                : 'text-green-600'
          }`} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">
              {importSummary.provas_incompletas > 0 || importSummary.questoes_faltando > 0
                ? 'Importação retomável concluída com provas incompletas'
                : importSummary.provas_com_erro > 0
                  ? 'Importação parcialmente concluída'
                  : 'Importação concluída!'}
            </p>
            <ul className="text-sm mt-1 space-y-0.5">
              <li>
                <strong>{importSummary.provas_criadas}</strong> prova(s) criadas ·{' '}
                <strong>{importSummary.provas_ja_existentes}</strong> já existentes ·{' '}
                <strong>{importSummary.provas_completas}</strong> completas ·{' '}
                <strong>{importSummary.provas_incompletas}</strong> incompletas
              </li>
              <li>
                Questões: <strong>{importSummary.questoes_inseridas}</strong> inseridas ·{' '}
                <strong>{importSummary.questoes_ja_existentes}</strong> já existiam ·{' '}
                <strong>{importSummary.questoes_atualizadas}</strong> atualizadas ·{' '}
                esperado <strong>{importSummary.questoes_esperadas}</strong>
                {importSummary.questoes_faltando > 0 && (
                  <> · <strong>{importSummary.questoes_faltando}</strong> faltando</>
                )}
              </li>
              {importSummary.provas_com_erro > 0 && (
                <li>
                  <strong>{importSummary.provas_com_erro}</strong> prova(s) com erro de processamento.
                </li>
              )}
            </ul>
            {importSummary.incompletas.length > 0 && (
              <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                {importSummary.incompletas.map((p) => (
                  <li key={`${p.id}-${p.nome}`} className="text-xs opacity-90">
                    <strong>{p.nome}</strong>: esperado {p.esperado}, no banco {p.atual}
                    {p.faltando > 0 ? ` (${p.faltando} faltando)` : ''}
                  </li>
                ))}
              </ul>
            )}
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

      {/* Admin — gestão de provas (leitura + atualização) */}
      {isAdmin && showAdminCrud && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200 bg-gray-50/80">
            <h2 className="text-lg font-semibold text-gray-800">Gestão de Provas</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Visualize e edite nome, banca, região, ano e tipo. Dados carregados diretamente do banco ({adminCrudTotal} prova{adminCrudTotal !== 1 ? 's' : ''}).
            </p>
          </div>

          <div className="border-b border-gray-200">
            <button
              type="button"
              onClick={() => setAdminCrudFiltrosAbertos((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 px-4 sm:px-6 py-3 text-left font-medium text-gray-800 hover:bg-gray-50 transition"
              aria-expanded={adminCrudFiltrosAbertos}
            >
              <span className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                Filtros
                {adminCrudHasFilters && (
                  <span className="text-xs font-normal text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">
                    ativos
                  </span>
                )}
              </span>
              {adminCrudFiltrosAbertos ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {adminCrudFiltrosAbertos && (
              <div className="px-4 sm:px-6 pb-4 bg-gray-50/50">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  <div className="sm:col-span-2 lg:col-span-3 xl:col-span-2">
                    <label htmlFor="admin-crud-search" className="block text-sm font-medium text-gray-700 mb-1">
                      Buscar por nome
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        id="admin-crud-search"
                        type="search"
                        value={adminCrudSearch}
                        onChange={(e) => setAdminCrudSearch(e.target.value)}
                        placeholder="Digite parte do nome da prova..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="admin-crud-banca" className="block text-sm font-medium text-gray-700 mb-1">Banca</label>
                    <select
                      id="admin-crud-banca"
                      value={adminCrudBanca}
                      onChange={(e) => setAdminCrudBanca(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm"
                    >
                      <option value="">Todas</option>
                      {adminCrudBancas.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-crud-regiao" className="block text-sm font-medium text-gray-700 mb-1">Região</label>
                    <select
                      id="admin-crud-regiao"
                      value={adminCrudRegiao}
                      onChange={(e) => setAdminCrudRegiao(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm"
                    >
                      <option value="">Todas</option>
                      {REGIOES_UF.map((uf) => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-crud-ano" className="block text-sm font-medium text-gray-700 mb-1">Ano</label>
                    <select
                      id="admin-crud-ano"
                      value={adminCrudAno}
                      onChange={(e) => setAdminCrudAno(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm"
                    >
                      <option value="">Todos</option>
                      {ANOS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-crud-tipo" className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                    <select
                      id="admin-crud-tipo"
                      value={adminCrudTipo}
                      onChange={(e) => setAdminCrudTipo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-sm"
                    >
                      <option value="">Todos</option>
                      {adminCrudTipos.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {adminCrudHasFilters && (
                  <button
                    type="button"
                    onClick={clearAdminCrudFilters}
                    className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            )}
          </div>

          {adminCrudMsg && (
            <div
              className={`mx-4 sm:mx-6 mt-4 p-3 rounded-lg text-sm border ${
                adminCrudMsg.type === 'success'
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {adminCrudMsg.text}
            </div>
          )}

          {loadingAdminCrud ? (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
              <p className="text-gray-600 mt-2">Carregando provas...</p>
            </div>
          ) : adminCrudList.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              {adminCrudHasFilters
                ? 'Nenhuma prova encontrada com os filtros selecionados.'
                : 'Nenhuma prova cadastrada no banco de dados.'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <th className="px-4 py-3 whitespace-nowrap">ID</th>
                      <th className="px-4 py-3 min-w-[200px]">Nome</th>
                      <th className="px-4 py-3 whitespace-nowrap">Banca</th>
                      <th className="px-4 py-3 whitespace-nowrap">Região</th>
                      <th className="px-4 py-3 whitespace-nowrap">Ano</th>
                      <th className="px-4 py-3 whitespace-nowrap">Tipo</th>
                      <th className="px-4 py-3 whitespace-nowrap text-center">Questões</th>
                      <th className="px-4 py-3 whitespace-nowrap text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {adminCrudList.map((prova) => {
                      const isEditing = editingProvaId === prova.id;
                      const isSaving = savingProvaId === prova.id;
                      return (
                        <tr key={prova.id} className={isEditing ? 'bg-primary-50/40' : 'hover:bg-gray-50/60'}>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{prova.id}</td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editProvaForm.nome}
                                onChange={(e) => setEditProvaForm((f) => ({ ...f, nome: e.target.value }))}
                                className="w-full min-w-[180px] px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              />
                            ) : (
                              <span className="font-medium text-gray-800">{prova.nome}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editProvaForm.banca}
                                onChange={(e) => setEditProvaForm((f) => ({ ...f, banca: e.target.value }))}
                                className="w-full min-w-[100px] px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                placeholder="Banca"
                              />
                            ) : (
                              <span className="text-gray-700">{prova.banca || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <select
                                value={editProvaForm.regiao}
                                onChange={(e) => setEditProvaForm((f) => ({ ...f, regiao: e.target.value }))}
                                className="w-full min-w-[80px] px-2 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              >
                                <option value="">—</option>
                                {REGIOES_UF.map((uf) => (
                                  <option key={uf} value={uf}>{uf}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-gray-700">{prova.regiao || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <select
                                value={editProvaForm.ano}
                                onChange={(e) => setEditProvaForm((f) => ({ ...f, ano: e.target.value }))}
                                className="w-full min-w-[80px] px-2 py-1.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              >
                                <option value="">—</option>
                                {ANOS.map((a) => (
                                  <option key={a} value={a}>{a}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-gray-700">{prova.ano || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editProvaForm.tipo}
                                onChange={(e) => setEditProvaForm((f) => ({ ...f, tipo: e.target.value }))}
                                className="w-full min-w-[100px] px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                placeholder="Tipo"
                              />
                            ) : (
                              <span className="text-gray-700">{prova.tipo || '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">{prova.question_count}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={cancelEditProva}
                                    disabled={isSaving}
                                    className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                    title="Cancelar"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveEditProva(prova.id)}
                                    disabled={isSaving}
                                    className="p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                                    title="Salvar"
                                  >
                                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startEditProva(prova)}
                                  disabled={editingProvaId !== null}
                                  className="p-2 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                  title="Editar prova"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-center gap-2 flex-wrap px-4 py-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setAdminCrudPage((p) => Math.max(1, p - 1))}
                  disabled={adminCrudPage <= 1 || loadingAdminCrud}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Anterior
                </button>
                <span className="px-4 py-2 text-sm text-gray-600">
                  Página {adminCrudPage} de {Math.max(1, adminCrudTotalPages)}
                  {adminCrudTotal > 0 && (
                    <span className="text-gray-400 ml-1">({adminCrudTotal} provas)</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setAdminCrudPage((p) => Math.min(adminCrudTotalPages, p + 1))}
                  disabled={adminCrudPage >= adminCrudTotalPages || loadingAdminCrud || adminCrudTotalPages <= 1}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Próxima
                </button>
              </div>
            </>
          )}
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
            Selecione um arquivo JSON para importar provas e questões. Reimportar completa provas incompletas (só insere questões faltantes).
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
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openIncompleteModal(prova)}
                      className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Prova Incompleta
                    </button>
                  )}
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
                Import idempotente: provas existentes são retomadas (questões faltantes inseridas). Arquivos grandes vão em lotes.
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

      {/* Modal Prova Incompleta */}
      {incompleteProva && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Prova incompleta</h2>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{incompleteProva.nome}</p>
              </div>
              <button
                type="button"
                onClick={closeIncompleteModal}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {incompleteError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{incompleteError}</div>
              )}
              {incompleteMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm">{incompleteMsg}</div>
              )}

              {incompleteStep === 'menu' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-800">O que você deseja fazer?</p>
                  <button
                    type="button"
                    onClick={() => { setIncompleteStep('add'); setIncompleteError(null); setIncompleteMsg(null); }}
                    className="w-full px-4 py-3 rounded-lg bg-primary-600 text-white font-medium text-sm hover:bg-primary-700 transition"
                  >
                    Adicionar questão
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRemoveStep()}
                    className="w-full px-4 py-3 rounded-lg border border-red-300 text-red-700 font-medium text-sm hover:bg-red-50 transition"
                  >
                    Excluir questão
                  </button>
                  <button
                    type="button"
                    onClick={closeIncompleteModal}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {incompleteStep === 'add' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => { setIncompleteStep('menu'); setIncompleteError(null); }}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    ← Voltar
                  </button>
                  <p className="text-sm text-gray-600">
                    Informe a posição de inserção. Questões com número ≥ essa posição serão deslocadas (+1).
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Número na prova *</label>
                    <input
                      type="number"
                      min={1}
                      value={addForm.numero_na_prova}
                      onChange={(e) => setAddForm((p) => ({ ...p, numero_na_prova: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Enunciado *</label>
                    <textarea
                      rows={4}
                      value={addForm.statement}
                      onChange={(e) => setAddForm((p) => ({ ...p, statement: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-gray-500">Imagens (opcional)</label>
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-dashed border-gray-300 text-xs text-gray-600 hover:border-primary-400 cursor-pointer">
                        <ImageIcon className="w-3.5 h-3.5" />
                        Adicionar
                        <input
                          ref={addImageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleAddImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                    {addImages.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {addImages.map((img, idx) => (
                          <div key={idx} className="relative">
                            <img src={img} alt="" className="h-20 w-auto max-w-[8rem] object-contain rounded border border-gray-200" />
                            <button
                              type="button"
                              onClick={() => setAddImages((prev) => prev.filter((_, i) => i !== idx))}
                              className="absolute -top-1 -right-1 p-0.5 bg-red-500 text-white rounded-full"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {(['a', 'b', 'c', 'd', 'e'] as const).map((letter) => {
                    const key = `option_${letter}` as 'option_a' | 'option_b' | 'option_c' | 'option_d' | 'option_e';
                    const required = letter === 'a' || letter === 'b';
                    return (
                      <div key={letter}>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">
                          Alternativa {letter.toUpperCase()}{required ? ' *' : ' (opcional)'}
                        </label>
                        <input
                          type="text"
                          value={addForm[key]}
                          onChange={(e) => setAddForm((p) => ({ ...p, [key]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    );
                  })}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Alternativa correta *</label>
                    <select
                      value={addForm.correct_answer}
                      onChange={(e) => setAddForm((p) => ({ ...p, correct_answer: e.target.value as 'A' | 'B' | 'C' | 'D' | 'E' }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      {addAvailableOptions.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitAddQuestion()}
                    disabled={incompleteLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg font-medium text-sm hover:bg-primary-700 disabled:opacity-60"
                  >
                    {incompleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar questão
                  </button>
                </div>
              )}

              {incompleteStep === 'remove' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => { setIncompleteStep('menu'); setIncompleteError(null); }}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    ← Voltar
                  </button>
                  <p className="text-sm text-gray-600">
                    A questão sai da prova (não é apagada do banco) e as posteriores são renumeradas (−1).
                  </p>
                  {incompleteLoading && removeQuestions.length === 0 ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary-600" /></div>
                  ) : removeQuestions.length === 0 ? (
                    <p className="text-sm text-gray-500">Esta prova não tem questões.</p>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Questão a excluir da prova</label>
                      <select
                        value={removeSelectedId ?? ''}
                        onChange={(e) => setRemoveSelectedId(parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        {removeQuestions.map((q) => (
                          <option key={q.id} value={q.id}>
                            #{q.numero_na_prova ?? '?'} — {q.statement.slice(0, 80)}{q.statement.length > 80 ? '…' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void submitRemoveQuestion()}
                    disabled={incompleteLoading || !removeSelectedId}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-60"
                  >
                    {incompleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Confirmar exclusão da prova
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
