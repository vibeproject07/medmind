'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, Image as ImageIcon, X, AlertTriangle, Ban, RotateCcw, Sparkles, Brain, ExternalLink, Loader2, Cpu } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import DeCSAutocomplete from '@/components/Common/DeCSAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import {
  ASSUNTOS_BY_AREA,
  toDisplayArea,
  toDisplayAssunto,
  fromDisplay,
  AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';

const AVAILABLE_TAGS = [
  'Ginecologia e Obstetrícia (G/O)',
  'Cirurgia Geral (CG)',
  'Pediatria (Pedi)',
  'Medicina da Família e Comunidade (MFC)',
  'Clínica Médica (CM)',
  'Ciclo Básico (CB)',
];

interface Question {
  id: number;
  statement: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e?: string | null;
  correct_answer: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation?: string | null;
  tags?: string[];
  images?: string[];
  areas_conhecimento?: string[];
  assuntos?: string[];
  exam_year?: number | null;
  exam_board?: string | null;
  exam_institution?: string | null;
  exam_region?: string | null;
  anulada?: boolean;
  decs_terms?: string[];
  ai_decs_descriptors?: DeCSRecord[];
  created_at: string;
  updated_at: string;
}

interface DeCSRecord {
  term: string;
  code: string;
  tree_ids: string[];
  hierarchy_path: string;
  role?: 'primary' | 'secondary';
  scope_note?: string;
  name_en?: string;
}

interface DeCSV2Descriptor {
  id: string;
  term: string;
  name_en?: string;
  scope_note?: string;
  tree_ids?: string[];
  hierarchy_path?: string;
  parents: Array<{ id: string; term: string }>;
  children: Array<{ id: string; term: string }>;
  role?: 'primary' | 'secondary';
}

interface DeCSV2Result {
  decs_primary: DeCSV2Descriptor[];
  decs_secondary: DeCSV2Descriptor[];
}

interface SimilarQuestion {
  id: number;
  statement: string;
  tags: string[];
  areas_conhecimento: string[];
  exam_year: number | null;
  exam_board: string | null;
  exam_institution: string | null;
  similarity: number;
}

export default function QuestionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const questionId = params?.id as string;
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [revealedAnswer, setRevealedAnswer] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editStatement, setEditStatement] = useState('');
  const [editOptionA, setEditOptionA] = useState('');
  const [editOptionB, setEditOptionB] = useState('');
  const [editOptionC, setEditOptionC] = useState('');
  const [editOptionD, setEditOptionD] = useState('');
  const [editOptionE, setEditOptionE] = useState('');
  const [editCorrectAnswer, setEditCorrectAnswer] = useState<'A' | 'B' | 'C' | 'D' | 'E'>('A');
  const [editExplanation, setEditExplanation] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editAreasConhecimento, setEditAreasConhecimento] = useState<string[]>([]);
  const [editAssuntos, setEditAssuntos] = useState<string[]>([]);
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editExamYear, setEditExamYear] = useState<number | null>(null);
  const [editExamBoard, setEditExamBoard] = useState('');
  const [editExamInstitution, setEditExamInstitution] = useState('');
  const [editExamRegion, setEditExamRegion] = useState('');
  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [editDecsTerms, setEditDecsTerms] = useState<string[]>([]);
  const [togglingAnulada, setTogglingAnulada] = useState(false);
  const [aiDecsLoading, setAiDecsLoading] = useState(false);
  const [aiDecsError, setAiDecsError] = useState<string | null>(null);
  const [aiDecsV2Loading, setAiDecsV2Loading] = useState(false);
  const [aiDecsV2Error, setAiDecsV2Error] = useState<string | null>(null);
  const [aiDecsV2Result, setAiDecsV2Result] = useState<DeCSV2Result | null>(null);
  const [showDecsV2, setShowDecsV2] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [similarQuestions, setSimilarQuestions] = useState<SimilarQuestion[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [hasEmbedding, setHasEmbedding] = useState(false);
  const [generatingEmbedding, setGeneratingEmbedding] = useState(false);

  const safeEditAreas = editAreasConhecimento ?? [];
  const safeEditAssuntos = editAssuntos ?? [];
  const editAssuntosOptions = useMemo(() => {
    if (safeEditAreas.length === 0) return [];
    const set = new Set<string>();
    safeEditAreas.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [safeEditAreas]);

  useEffect(() => {
    if (safeEditAreas.length === 0) {
      setEditAssuntos([]);
      return;
    }
    const opcoes = new Set<string>();
    safeEditAreas.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setEditAssuntos((prev) => (prev ?? []).filter((a) => opcoes.has(a)));
  }, [safeEditAreas]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const role = payload.role || 'regular';
        setIsAdmin(role === 'admin');
        // Admin sempre vê a resposta
        if (role === 'admin') {
          setRevealedAnswer(true);
        }
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (questionId) {
      fetchQuestion();
    }
  }, [questionId]);

  // Fetch embedding status and similar questions
  useEffect(() => {
    if (!questionId) return;
    const idNum = parseInt(questionId);
    if (isNaN(idNum)) return;

    (async () => {
      try {
        const embRes = await fetch(`/api/questions/${questionId}/embedding`);
        if (embRes.ok) {
          const { hasEmbedding: has } = await embRes.json();
          setHasEmbedding(has);
          if (has) {
            setSimilarLoading(true);
            const simRes = await fetch(`/api/questions/${questionId}/similar?limit=5`);
            if (simRes.ok) {
              const { questions: sq } = await simRes.json();
              setSimilarQuestions(sq ?? []);
            }
            setSimilarLoading(false);
          }
        }
      } catch {
        // non-critical — silently ignore
      }
    })();
  }, [questionId]);

  // Load existing V2 results on page load (non-critical)
  useEffect(() => {
    if (!questionId) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/questions/${questionId}/decs-ai-v2`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const r = data.result as DeCSV2Result;
          if (r && (r.decs_primary?.length > 0 || r.decs_secondary?.length > 0)) {
            setAiDecsV2Result(r);
          }
        }
      } catch {
        // non-critical
      }
    })();
  }, [questionId]);

  const handleGenerateEmbedding = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setGeneratingEmbedding(true);
    try {
      const res = await fetch(`/api/questions/${questionId}/embedding`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setHasEmbedding(true);
        setSimilarLoading(true);
        const simRes = await fetch(`/api/questions/${questionId}/similar?limit=5`);
        if (simRes.ok) {
          const { questions: sq } = await simRes.json();
          setSimilarQuestions(sq ?? []);
        }
        setSimilarLoading(false);
      }
    } catch (err) {
      console.error('Erro ao gerar embedding', err);
    } finally {
      setGeneratingEmbedding(false);
    }
  };

  // Ajustar resposta correta quando alternativas opcionais são removidas durante edição
  useEffect(() => {
    if (!isEditing) return;
    
    const availableOptions: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B'];
    if (editOptionC.trim()) availableOptions.push('C');
    if (editOptionD.trim()) availableOptions.push('D');
    if (editOptionE.trim()) availableOptions.push('E');

    // Se a resposta correta atual não está nas opções disponíveis, ajustar para A
    if (!availableOptions.includes(editCorrectAnswer)) {
      setEditCorrectAnswer('A');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOptionC, editOptionD, editOptionE, isEditing]);

  const fetchQuestion = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch(`/api/questions/${questionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const normalized = {
          ...data,
          tags: Array.isArray(data.tags) ? data.tags : [],
          images: Array.isArray(data.images) ? data.images : [],
          areas_conhecimento: Array.isArray(data.areas_conhecimento) ? data.areas_conhecimento : [],
          assuntos: Array.isArray(data.assuntos) ? data.assuntos : [],
          decs_terms: Array.isArray(data.decs_terms) ? data.decs_terms : [],
        };
        setQuestion(normalized);
        // Inicializar campos de edição
        setEditStatement(data.statement);
        setEditOptionA(data.option_a);
        setEditOptionB(data.option_b);
        setEditOptionC(data.option_c || '');
        setEditOptionD(data.option_d || '');
        setEditOptionE(data.option_e || '');
        setEditCorrectAnswer(data.correct_answer);
        setEditExplanation(data.explanation || '');
        setEditTags(normalized.tags);
        setEditAreasConhecimento(normalized.areas_conhecimento);
        setEditAssuntos(normalized.assuntos);
        setEditImages(normalized.images);
        setEditDecsTerms(normalized.decs_terms);
        setEditExamYear(data.exam_year || null);
        setEditExamBoard(data.exam_board || '');
        setEditExamInstitution(data.exam_institution || '');
        setEditExamRegion(data.exam_region || '');
      } else if (response.status === 404) {
        router.push('/dashboard/questions');
      } else {
        router.push('/dashboard/questions');
      }
    } catch (error) {
      console.error('Erro ao buscar questão:', error);
      router.push('/dashboard/questions');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        alert('Apenas arquivos de imagem são permitidos');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setEditImages((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setEditImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEdit = () => {
    setIsEditing(true);
    if (question) {
      setEditStatement(question.statement);
      setEditOptionA(question.option_a);
      setEditOptionB(question.option_b);
      setEditOptionC(question.option_c || '');
      setEditOptionD(question.option_d || '');
      setEditOptionE(question.option_e || '');
      setEditCorrectAnswer(question.correct_answer);
      setEditExplanation(question.explanation || '');
      setEditTags(question.tags || []);
      setEditAreasConhecimento(question.areas_conhecimento || []);
      setEditAssuntos(question.assuntos || []);
      setEditImages(question.images || []);
      setEditDecsTerms(question.decs_terms || []);
      setEditExamYear(question.exam_year || null);
      setEditExamBoard(question.exam_board || '');
      setEditExamInstitution(question.exam_institution || '');
      setEditExamRegion(question.exam_region || '');
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (question) {
      setEditStatement(question.statement);
      setEditOptionA(question.option_a);
      setEditOptionB(question.option_b);
      setEditOptionC(question.option_c || '');
      setEditOptionD(question.option_d || '');
      setEditOptionE(question.option_e || '');
      setEditCorrectAnswer(question.correct_answer);
      setEditExplanation(question.explanation || '');
      setEditTags(question.tags || []);
      setEditAreasConhecimento(question.areas_conhecimento || []);
      setEditAssuntos(question.assuntos || []);
      setEditImages(question.images || []);
      setEditDecsTerms(question.decs_terms || []);
      setEditExamYear(question.exam_year || null);
      setEditExamBoard(question.exam_board || '');
      setEditExamInstitution(question.exam_institution || '');
      setEditExamRegion(question.exam_region || '');
    }
  };

  const handleSaveEdit = async () => {
    if (!editStatement.trim() || !editOptionA.trim() || !editOptionB.trim()) {
      alert('O enunciado e as alternativas A e B são obrigatórios.');
      return;
    }

    // Validar que a resposta correta está entre as alternativas preenchidas
    const availableOptions: ('A' | 'B' | 'C' | 'D' | 'E')[] = ['A', 'B'];
    if (editOptionC.trim()) availableOptions.push('C');
    if (editOptionD.trim()) availableOptions.push('D');
    if (editOptionE.trim()) availableOptions.push('E');

    if (!availableOptions.includes(editCorrectAnswer)) {
      alert('A resposta correta deve ser uma das alternativas preenchidas.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const payload: any = {
        statement: editStatement.trim(),
        option_a: editOptionA.trim(),
        option_b: editOptionB.trim(),
        correct_answer: editCorrectAnswer,
        tags: editTags,
        images: editImages,
      };

      if (editOptionC.trim()) payload.option_c = editOptionC.trim();
      if (editOptionD.trim()) payload.option_d = editOptionD.trim();
      if (editOptionE.trim()) payload.option_e = editOptionE.trim();
      if (editExplanation.trim()) payload.explanation = editExplanation.trim();
      payload.areas_conhecimento = editAreasConhecimento;
      payload.assuntos = editAssuntos;
      payload.decs_terms = editDecsTerms;
      payload.exam_year = editExamYear || null;
      payload.exam_board = editExamBoard || null;
      payload.exam_institution = editExamInstitution || null;
      payload.exam_region = editExamRegion || null;

      const response = await fetch(`/api/questions/${questionId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const raw = await response.json();
        const updatedQuestion = {
          ...raw,
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          images: Array.isArray(raw.images) ? raw.images : [],
          areas_conhecimento: Array.isArray(raw.areas_conhecimento) ? raw.areas_conhecimento : [],
          assuntos: Array.isArray(raw.assuntos) ? raw.assuntos : [],
          decs_terms: Array.isArray(raw.decs_terms) ? raw.decs_terms : [],
        };
        setQuestion(updatedQuestion);
        setIsEditing(false);
      } else {
        const error = await response.json();
        alert(error.error || 'Erro ao salvar as alterações');
      }
    } catch (error) {
      console.error('Erro ao salvar questão:', error);
      alert('Erro ao salvar as alterações');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Tem certeza que deseja excluir esta questão?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch(`/api/questions/${questionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        router.push('/dashboard/questions');
      } else {
        alert('Erro ao excluir a questão');
      }
    } catch (error) {
      console.error('Erro ao excluir questão:', error);
      alert('Erro ao excluir a questão');
    }
  };

  const handleGenerateAiDecs = async () => {
    if (!question) return;
    setAiDecsLoading(true);
    setAiDecsError(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/questions/${questionId}/decs-ai`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setAiDecsError(data.error || 'Erro ao gerar descritores IA.');
        return;
      }
      setQuestion((prev) =>
        prev ? { ...prev, ai_decs_descriptors: data.descriptors } : prev
      );
    } catch {
      setAiDecsError('Erro ao conectar com o servidor.');
    } finally {
      setAiDecsLoading(false);
    }
  };

  const handleGenerateAiDecsV2 = async () => {
    if (!question) return;
    setAiDecsV2Loading(true);
    setAiDecsV2Error(null);
    setShowDecsV2(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/questions/${questionId}/decs-ai-v2`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setAiDecsV2Error(data.error || 'Erro ao gerar descritores v2.');
        return;
      }
      setAiDecsV2Result(data.result as DeCSV2Result);
    } catch {
      setAiDecsV2Error('Erro ao conectar com o servidor.');
    } finally {
      setAiDecsV2Loading(false);
    }
  };

  const handleToggleAnulada = async () => {
    if (!question) return;
    const novaAnulada = !question.anulada;
    const confirmMsg = novaAnulada
      ? 'Anular esta questão? Ela ficará inacessível para simulados, mas continuará visível nas suas provas.'
      : 'Reativar esta questão? Ela voltará a estar disponível para simulados.';
    if (!confirm(confirmMsg)) return;

    setTogglingAnulada(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/questions/${questionId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ anulada: novaAnulada }),
      });
      if (res.ok) {
        const raw = await res.json();
        setQuestion((prev) => prev ? { ...prev, anulada: raw.anulada } : prev);
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao atualizar questão.');
      }
    } catch {
      alert('Erro ao atualizar questão.');
    } finally {
      setTogglingAnulada(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-2">Carregando questão...</p>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg">Questão não encontrada.</p>
          <button
            onClick={() => router.push('/dashboard/questions')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Voltar para Questões
          </button>
        </div>
      </div>
    );
  }

  const getOptionClass = (option: string) => {
    if (!revealedAnswer) {
      return 'bg-gray-50 border border-gray-200';
    }
    if (question.correct_answer === option) {
      return 'bg-green-50 border-2 border-green-500';
    }
    return 'bg-gray-50 border border-gray-200';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-800">Questão #{question.id}</h1>
              {question.anulada && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                  <Ban className="w-3.5 h-3.5" />
                  ANULADA
                </span>
              )}
            </div>
            <p className="text-gray-600 mt-1">Criada em {formatDate(question.created_at)}</p>
          </div>
        </div>

        {isAdmin && !isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleAnulada}
              disabled={togglingAnulada}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition text-sm font-medium disabled:opacity-60 ${
                question.anulada
                  ? 'border-green-300 text-green-700 hover:bg-green-50'
                  : 'border-red-300 text-red-700 hover:bg-red-50'
              }`}
            >
              {question.anulada ? <RotateCcw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
              {togglingAnulada ? 'Salvando...' : question.anulada ? 'Reativar questão' : 'Anular questão'}
            </button>
            <button
              onClick={handleEdit}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
            >
              <Edit className="w-4 h-4" />
              Editar
            </button>
          </div>
        )}
      </div>

      {/* Banner de alerta — questão anulada */}
      {question.anulada && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-800">Questão anulada</p>
            <p className="text-sm text-red-700 mt-0.5">
              Esta questão está anulada e não pode ser incluída em simulados. Ela permanece visível nas provas onde foi originalmente inserida.
            </p>
          </div>
        </div>
      )}

      {/* Tags: Área do Conhecimento, Assunto e Especialidade - sempre visíveis no topo */}
      {((question.tags ?? []).length > 0 || (question.areas_conhecimento ?? []).length > 0 || (question.assuntos ?? []).length > 0) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap gap-2 items-center">
            {(question.areas_conhecimento ?? []).map((area) => (
              <span
                key={`area-${area}`}
                className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
              >
                {toDisplayArea(area)}
              </span>
            ))}
            {(question.assuntos ?? []).map((assunto) => (
              <span
                key={`assunto-${assunto}`}
                className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
              >
                {toDisplayAssunto(assunto)}
              </span>
            ))}
            {(question.tags ?? []).map((tag) => (
              <span
                key={`tag-${tag}`}
                className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Enunciado */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Enunciado
        </label>
        {isEditing ? (
          <textarea
            value={editStatement}
            onChange={(e) => setEditStatement(e.target.value)}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="Digite o enunciado da questão"
            required
          />
        ) : (
          <>
            <p className="text-gray-700 text-lg leading-relaxed">{question.statement}</p>
            {(question.images ?? []).length > 0 && (
              <div className="mt-6 flex flex-wrap justify-center gap-4">
                {(Array.isArray(question.images) ? question.images : []).map((image, index) => (
                  <ImageLightbox
                    key={index}
                    src={image}
                    alt={`Imagem ${index + 1}`}
                    className="h-48 w-auto max-w-xs"
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Imagens (upload — somente ao editar) */}
      {isEditing && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Imagens
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-400 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
              id="question-detail-image-upload"
            />
            <label
              htmlFor="question-detail-image-upload"
              className="flex flex-col items-center justify-center cursor-pointer py-4"
            >
              <ImageIcon className="w-10 h-10 text-gray-400 mb-2" />
              <span className="text-sm text-gray-600 font-medium">
                Clique para adicionar imagens
              </span>
              <span className="text-xs text-gray-500 mt-1">
                PNG, JPG, GIF até 10MB
              </span>
            </label>
          </div>

          {(editImages ?? []).length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {(editImages ?? []).map((image, index) => (
                <div key={index} className="relative group">
                  <img
                    src={image}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-32 object-cover rounded-lg border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remover imagem"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Alternativas */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Alternativas</h2>
        <div className="space-y-3">
          {/* Alternativa A */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Alternativa A <span className="text-red-500">*</span>
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editOptionA}
                onChange={(e) => setEditOptionA(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Digite a alternativa A"
                required
              />
            ) : (
              <div className={`p-4 rounded-lg ${getOptionClass('A')} transition`}>
                <span className="font-semibold text-gray-700 text-base">A)</span>
                <span className="ml-3 text-gray-700 text-base">{question.option_a}</span>
              </div>
            )}
          </div>

          {/* Alternativa B */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Alternativa B <span className="text-red-500">*</span>
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editOptionB}
                onChange={(e) => setEditOptionB(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Digite a alternativa B"
                required
              />
            ) : (
              <div className={`p-4 rounded-lg ${getOptionClass('B')} transition`}>
                <span className="font-semibold text-gray-700 text-base">B)</span>
                <span className="ml-3 text-gray-700 text-base">{question.option_b}</span>
              </div>
            )}
          </div>

          {/* Alternativa C */}
          {(isEditing || question.option_c) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Alternativa C
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={editOptionC}
                  onChange={(e) => setEditOptionC(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Digite a alternativa C (opcional)"
                />
              ) : question.option_c ? (
                <div className={`p-4 rounded-lg ${getOptionClass('C')} transition`}>
                  <span className="font-semibold text-gray-700 text-base">C)</span>
                  <span className="ml-3 text-gray-700 text-base">{question.option_c}</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Alternativa D */}
          {(isEditing || question.option_d) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Alternativa D
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={editOptionD}
                  onChange={(e) => setEditOptionD(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Digite a alternativa D (opcional)"
                />
              ) : question.option_d ? (
                <div className={`p-4 rounded-lg ${getOptionClass('D')} transition`}>
                  <span className="font-semibold text-gray-700 text-base">D)</span>
                  <span className="ml-3 text-gray-700 text-base">{question.option_d}</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Alternativa E */}
          {(isEditing || question.option_e) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Alternativa E
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={editOptionE}
                  onChange={(e) => setEditOptionE(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Digite a alternativa E (opcional)"
                />
              ) : question.option_e ? (
                <div className={`p-4 rounded-lg ${getOptionClass('E')} transition`}>
                  <span className="font-semibold text-gray-700 text-base">E)</span>
                  <span className="ml-3 text-gray-700 text-base">{question.option_e}</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Resposta Correta */}
        {isEditing && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Resposta Correta <span className="text-red-500">*</span>
            </label>
            <select
              value={editCorrectAnswer}
              onChange={(e) => setEditCorrectAnswer(e.target.value as 'A' | 'B' | 'C' | 'D' | 'E')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              required
            >
              <option value="A">A</option>
              <option value="B">B</option>
              {editOptionC.trim() && <option value="C">C</option>}
              {editOptionD.trim() && <option value="D">D</option>}
              {editOptionE.trim() && <option value="E">E</option>}
            </select>
          </div>
        )}
      </div>

      {/* Botão para revelar resposta (apenas para não-admin e quando não está editando) */}
      {!isAdmin && !isEditing && (
        <div className="flex justify-center">
          <button
            onClick={() => setRevealedAnswer(!revealedAnswer)}
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium text-lg"
          >
            {revealedAnswer ? 'Ocultar Resposta Correta' : 'Revelar Resposta Correta'}
          </button>
        </div>
      )}

      {/* Explicação */}
      {!isEditing && revealedAnswer && question.explanation && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">Explicação</h3>
          <p className="text-blue-700 leading-relaxed">{question.explanation}</p>
        </div>
      )}

      {/* Campo de Explicação (quando editando) */}
      {isEditing && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Explicação
          </label>
          <textarea
            value={editExplanation}
            onChange={(e) => setEditExplanation(e.target.value)}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="Digite a explicação da resposta correta (opcional)"
          />
        </div>
      )}

      {/* Informações da Prova */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Informações da Prova</h3>
        {isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit_exam_year" className="block text-sm font-medium text-gray-700 mb-2">
                Ano da Prova
              </label>
              <input
                type="number"
                id="edit_exam_year"
                value={editExamYear || ''}
                onChange={(e) => {
                  const value = e.target.value ? parseInt(e.target.value) : null;
                  setEditExamYear(value);
                }}
                placeholder="Ex: 2024"
                min="1900"
                max="2100"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="edit_exam_board" className="block text-sm font-medium text-gray-700 mb-2">
                Banca da Prova
              </label>
              <input
                type="text"
                id="edit_exam_board"
                value={editExamBoard}
                onChange={(e) => setEditExamBoard(e.target.value)}
                placeholder="Ex: FGV, VUNESP, CESPE"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="edit_exam_institution" className="block text-sm font-medium text-gray-700 mb-2">
                Instituição associada à Prova
              </label>
              <input
                type="text"
                id="edit_exam_institution"
                value={editExamInstitution}
                onChange={(e) => setEditExamInstitution(e.target.value)}
                placeholder="Ex: USP, UNIFESP"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="edit_exam_region" className="block text-sm font-medium text-gray-700 mb-2">
                Região
              </label>
              <input
                type="text"
                id="edit_exam_region"
                value={editExamRegion}
                onChange={(e) => setEditExamRegion(e.target.value)}
                placeholder="Ex: Sudeste, Nordeste, Sul"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {question.exam_year && (
              <div>
                <span className="text-sm font-medium text-gray-700">Ano da Prova:</span>
                <p className="text-gray-900">{question.exam_year}</p>
              </div>
            )}
            {question.exam_board && (
              <div>
                <span className="text-sm font-medium text-gray-700">Banca da Prova:</span>
                <p className="text-gray-900">{question.exam_board}</p>
              </div>
            )}
            {question.exam_institution && (
              <div>
                <span className="text-sm font-medium text-gray-700">Instituição associada à Prova:</span>
                <p className="text-gray-900">{question.exam_institution}</p>
              </div>
            )}
            {question.exam_region && (
              <div>
                <span className="text-sm font-medium text-gray-700">Região:</span>
                <p className="text-gray-900">{question.exam_region}</p>
              </div>
            )}
            {!question.exam_year && !question.exam_board && !question.exam_institution && !question.exam_region && (
              <p className="text-gray-400 italic text-sm">Nenhuma informação da prova adicionada</p>
            )}
          </div>
        )}
      </div>

      {/* Área do Conhecimento e Assunto - editáveis apenas quando o botão Editar estiver acionado */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Área do Conhecimento e Assunto</h3>
        {isEditing ? (
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
              <TagAutocomplete
                options={AREAS_OPTIONS_DISPLAY}
                selectedTags={safeEditAreas.map(toDisplayArea)}
                onChange={(tags) => setEditAreasConhecimento(Array.isArray(tags) ? tags.map(fromDisplay) : [])}
                label="Área do Conhecimento"
                placeholder="Selecione áreas do conhecimento..."
                onSaveNewTag={() => {}}
              />
            </div>
            <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
              <TagAutocomplete
                options={editAssuntosOptions.map(toDisplayAssunto)}
                selectedTags={safeEditAssuntos.map(toDisplayAssunto)}
                onChange={(tags) => setEditAssuntos(Array.isArray(tags) ? tags.map(fromDisplay) : [])}
                label="Assunto"
                placeholder={safeEditAreas.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Selecione assuntos...'}
                onSaveNewTag={() => {}}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Área do Conhecimento</label>
              {question.areas_conhecimento && question.areas_conhecimento.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {question.areas_conhecimento.map((area) => (
                    <span
                      key={area}
                      className="inline-block px-3 py-1 text-sm font-medium rounded-full bg-primary-100 text-primary-700"
                    >
                      {area}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 italic text-sm">Nenhuma área selecionada</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assunto</label>
              {(question.assuntos ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(Array.isArray(question.assuntos) ? question.assuntos : []).map((assunto) => (
                    <span
                      key={assunto}
                      className="inline-block px-3 py-1 text-sm font-medium bg-primary-100 text-primary-700 rounded-full"
                    >
                      {toDisplayAssunto(assunto)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 italic text-sm">Nenhum assunto selecionado</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tags - Aparecem no final, após explicação */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tags ou Especialidade
        </label>
        {isEditing ? (
          <TagAutocomplete
            options={availableTags}
            selectedTags={editTags}
            onChange={(tags) => setEditTags(tags)}
            onSaveNewTag={(newTag) => {
              if (!availableTags.includes(newTag)) {
                setAvailableTags([...availableTags, newTag]);
              }
            }}
            label=""
            placeholder="Digite para buscar tags..."
          />
        ) : (
          (question.tags ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {(Array.isArray(question.tags) ? question.tags : []).map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-3 py-1 text-sm font-medium bg-primary-100 text-primary-700 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 italic text-sm">Nenhuma tag adicionada</p>
          )
        )}
      </div>

      {/* Termos DeCS/MeSH */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-lg font-semibold text-gray-800">Termos DeCS/MeSH</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">vocabulário controlado BVS</span>
        </div>
        {isEditing ? (
          <DeCSAutocomplete
            selectedTerms={editDecsTerms}
            onChange={setEditDecsTerms}
            onTagAdd={(term) => {
              if (!editTags.includes(term)) {
                setEditTags([...editTags, term]);
              }
            }}
            label="Buscar e adicionar termos"
            placeholder="Ex: Hipertensão, Diabetes Mellitus..."
          />
        ) : (
          (question.decs_terms ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {(question.decs_terms ?? []).map((term) => (
                <span
                  key={term}
                  className="inline-block px-3 py-1 text-sm font-medium bg-primary-100 text-primary-700 rounded-full"
                >
                  {term}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 italic text-sm">Nenhum termo DeCS adicionado</p>
          )
        )}
      </div>

      {/* Descritores DeCS gerados por IA */}
      {isAdmin && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              <h3 className="text-lg font-semibold text-gray-800">Descritores DeCS — IA</h3>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">gerado automaticamente</span>
            </div>
            {!isEditing && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateAiDecs}
                  disabled={aiDecsLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiDecsLoading ? 'Gerando…' : 'Gerar v1'}
                </button>
                <button
                  onClick={handleGenerateAiDecsV2}
                  disabled={aiDecsV2Loading}
                  title="Pipeline v2: interpretação semântica profunda + busca RAG no banco DeCS + hierarquia completa"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {aiDecsV2Loading ? 'Gerando v2…' : 'Gerar v2 (RAG)'}
                </button>
              </div>
            )}
          </div>

          {/* V1 results */}
          {aiDecsError && (
            <p className="text-red-500 text-sm mb-2">{aiDecsError}</p>
          )}
          {(question.ai_decs_descriptors ?? []).length > 0 ? (() => {
            const allDescriptors = question.ai_decs_descriptors ?? [];
            const primaryDescs = allDescriptors.filter((d) => d.role === 'primary');
            const secondaryDescs = allDescriptors.filter((d) => d.role === 'secondary');
            const untagged = allDescriptors.filter((d) => !d.role);
            return (
              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Pipeline v1</p>
                {(primaryDescs.length > 0 || untagged.length > 0) && (
                  <div>
                    {primaryDescs.length > 0 && (
                      <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wide mb-1.5">Temas Principais</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {[...primaryDescs, ...untagged].map((d) => (
                        <span
                          key={d.code || d.term}
                          title={d.hierarchy_path || d.tree_ids?.join(', ')}
                          className="inline-flex flex-col px-3 py-1.5 text-sm font-semibold bg-indigo-100 text-indigo-800 rounded-full border border-indigo-300 cursor-default"
                        >
                          <span>{d.term}</span>
                          {d.code && (
                            <span className="text-xs text-indigo-400 leading-tight">{d.code}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {secondaryDescs.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Temas Secundários</p>
                    <div className="flex flex-wrap gap-2">
                      {secondaryDescs.map((d) => (
                        <span
                          key={d.code || d.term}
                          title={d.hierarchy_path || d.tree_ids?.join(', ')}
                          className="inline-flex flex-col px-3 py-1.5 text-sm font-medium bg-slate-50 text-slate-600 rounded-full border border-slate-200 cursor-default"
                        >
                          <span>{d.term}</span>
                          {d.code && (
                            <span className="text-xs text-slate-400 leading-tight">{d.code}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })() : (
            <p className="text-gray-400 italic text-sm mb-3">
              {aiDecsLoading ? 'Aguardando resposta da IA…' : 'Nenhum descritor v1 gerado. Clique em "Gerar v1" para classificar esta questão.'}
            </p>
          )}

          {/* V2 results — RAG-enhanced with hierarchy */}
          {(aiDecsV2Result || aiDecsV2Loading || aiDecsV2Error) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Pipeline v2 — RAG + Hierarquia</p>
                  <button
                    onClick={() => setShowDecsV2(!showDecsV2)}
                    className="text-xs text-gray-400 hover:text-gray-600 transition"
                  >
                    {showDecsV2 ? '▲ ocultar' : '▼ expandir'}
                  </button>
                </div>
              </div>

              {aiDecsV2Error && (
                <p className="text-red-500 text-sm mb-2">{aiDecsV2Error}</p>
              )}

              {showDecsV2 && aiDecsV2Result && (
                <div className="space-y-4">
                  {aiDecsV2Result.decs_primary.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2">Descritores Primários</p>
                      <div className="space-y-2">
                        {aiDecsV2Result.decs_primary.map((d) => (
                          <div key={d.id} className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-sm font-semibold text-emerald-800">{d.term}</span>
                                {d.name_en && (
                                  <span className="ml-2 text-xs text-emerald-500 italic">{d.name_en}</span>
                                )}
                              </div>
                              <span className="text-xs text-emerald-400 font-mono shrink-0">{d.id}</span>
                            </div>
                            {d.scope_note && (
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.scope_note}</p>
                            )}
                            {d.hierarchy_path && (
                              <p className="text-xs text-emerald-400 mt-1">{d.hierarchy_path}</p>
                            )}
                            {d.parents.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1 items-center">
                                <span className="text-xs text-gray-400">↑ pai:</span>
                                {d.parents.map((p) => (
                                  <span key={p.id} className="text-xs px-1.5 py-0.5 bg-white border border-emerald-200 rounded text-emerald-600">{p.term}</span>
                                ))}
                              </div>
                            )}
                            {d.children.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1 items-center">
                                <span className="text-xs text-gray-400">↓ filhos:</span>
                                {d.children.map((c) => (
                                  <span key={c.id} className="text-xs px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500">{c.term}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {aiDecsV2Result.decs_secondary.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Descritores Secundários</p>
                      <div className="space-y-2">
                        {aiDecsV2Result.decs_secondary.map((d) => (
                          <div key={d.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-sm font-medium text-slate-700">{d.term}</span>
                                {d.name_en && (
                                  <span className="ml-2 text-xs text-slate-400 italic">{d.name_en}</span>
                                )}
                              </div>
                              <span className="text-xs text-slate-400 font-mono shrink-0">{d.id}</span>
                            </div>
                            {d.scope_note && (
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.scope_note}</p>
                            )}
                            {d.parents.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1 items-center">
                                <span className="text-xs text-gray-400">↑ pai:</span>
                                {d.parents.map((p) => (
                                  <span key={p.id} className="text-xs px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500">{p.term}</span>
                                ))}
                              </div>
                            )}
                            {d.children.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1 items-center">
                                <span className="text-xs text-gray-400">↓ filhos:</span>
                                {d.children.map((c) => (
                                  <span key={c.id} className="text-xs px-1.5 py-0.5 bg-white border border-gray-100 rounded text-gray-400">{c.term}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showDecsV2 && aiDecsV2Loading && (
                <p className="text-sm text-emerald-500 italic">Executando pipeline RAG… pode levar alguns segundos.</p>
              )}

              {showDecsV2 && !aiDecsV2Loading && !aiDecsV2Error && (!aiDecsV2Result || (aiDecsV2Result.decs_primary.length === 0 && aiDecsV2Result.decs_secondary.length === 0)) && (
                <p className="text-gray-400 italic text-sm">Nenhum resultado v2 ainda.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Questões Similares (via pgvector) */}
      {!isEditing && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-violet-500" />
              <h3 className="text-lg font-semibold text-gray-800">Questões Similares</h3>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">busca semântica</span>
            </div>
            {isAdmin && !hasEmbedding && (
              <button
                onClick={handleGenerateEmbedding}
                disabled={generatingEmbedding}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition"
              >
                {generatingEmbedding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Cpu className="h-3.5 w-3.5" />
                )}
                {generatingEmbedding ? 'Gerando embedding…' : 'Gerar Embedding'}
              </button>
            )}
          </div>

          {similarLoading || generatingEmbedding ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{generatingEmbedding ? 'Gerando embedding vetorial…' : 'Buscando questões similares…'}</span>
            </div>
          ) : !hasEmbedding ? (
            <div className="text-center py-6">
              <Brain className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">
                {isAdmin
                  ? 'Esta questão ainda não tem embedding vetorial. Clique em "Gerar Embedding" para ativar a busca semântica.'
                  : 'Embedding vetorial não gerado para esta questão.'}
              </p>
            </div>
          ) : similarQuestions.length === 0 ? (
            <p className="text-gray-400 italic text-sm">Nenhuma questão similar encontrada com similaridade suficiente.</p>
          ) : (
            <div className="space-y-3">
              {similarQuestions.map((sq) => (
                <div
                  key={sq.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 line-clamp-2">{sq.statement}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {sq.exam_year && (
                        <span className="text-xs text-gray-500">{sq.exam_year}</span>
                      )}
                      {sq.exam_board && (
                        <span className="text-xs text-gray-500">· {sq.exam_board}</span>
                      )}
                      {sq.exam_institution && (
                        <span className="text-xs text-gray-500">· {sq.exam_institution}</span>
                      )}
                      {sq.areas_conhecimento?.slice(0, 2).map((area) => (
                        <span key={area} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full">
                          {area}
                        </span>
                      ))}
                      <span className="ml-auto text-xs font-medium text-violet-600">
                        {Math.round(sq.similarity * 100)}% similar
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/dashboard/questions/${sq.id}`)}
                    className="flex-shrink-0 p-1.5 text-gray-400 hover:text-violet-600 transition opacity-0 group-hover:opacity-100"
                    title="Ver questão"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Botões de ação quando editando */}
      {isEditing && (
        <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={handleSaveEdit}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Salvar alterações
          </button>
          <button
            onClick={handleCancelEdit}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Informações adicionais */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <div>
            <span className="font-medium">Criada em:</span> {formatDate(question.created_at)}
          </div>
          {question.updated_at !== question.created_at && (
            <div>
              <span className="font-medium">Atualizada em:</span> {formatDate(question.updated_at)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
