'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap, X, ChevronLeft, ChevronRight, Mic, Upload, Link as LinkIcon } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ResumoAulasModal from '@/components/Dashboard/ResumoAulasModal';

const AVAILABLE_TAGS = [
  'Ginecologia e Obstetrícia (G/O)',
  'Cirurgia Geral (CG)',
  'Pediatria (Pedi)',
  'Medicina da Família e Comunidade (MFC)',
  'Clínica Médica (CM)',
  'Ciclo Básico (CB)',
];

const AREAS_CONHECIMENTO_OPTIONS = [
  'Ciclo Básico',
  'Cirurgia Geral',
  'Clínica Médica',
  'Ginecologia e Obstetrícia',
  'Medicina da Família e Comunidade (MFC)',
  'Pediatria',
];

const AREAS_SIGLAS: Record<string, string> = {
  'Ciclo Básico': 'CB',
  'Cirurgia Geral': 'CG',
  'Clínica Médica': 'CM',
  'Ginecologia e Obstetrícia': 'G/O',
  'Medicina da Família e Comunidade (MFC)': 'MFC',
  'Pediatria': 'Pedi',
};

/** Cores de fundo do seletor Colorido (Condicionantes) por área do conhecimento */
const AREAS_COLORIDO_BG: Record<string, string> = {
  'Ciclo Básico': '#FFADAD',
  'Cirurgia Geral': '#FFD6A5',
  'Clínica Médica': '#FDFFB6',
  'Ginecologia e Obstetrícia': '#CAFFBF',
  'Medicina da Família e Comunidade (MFC)': '#9BF6FF',
  'Pediatria': '#ffc6ff',
};

const ASSUNTOS_BY_AREA: Record<string, string[]> = {
  'Ciclo Básico': [
    'Anatomia',
    'Farmacologia',
    'Fisiologia',
    'Imunologia',
    'Infectologia',
    'Microbiologia',
    'Patologia',
  ],
  'Cirurgia Geral': [
    'Abdome Agudo',
    'Câncer Colorretal',
    'Câncer Gástrico',
    'Cicatrização',
    'Cirurgia Pediátrica',
    'Complicações Pós-operatórias',
    'Doença da Vesícula Vias Biliares',
    'Doença do Refluxo Gastroesofágico (DRGE)',
    'Hérnias da Parede Abdominal',
    'Pré-operatório',
    'Queimaduras',
    'Resposta Metabólica ao Trauma (REMIT)',
    'Risco Cirúrgico',
    'Trauma e ATLS',
  ],
  'Clínica Médica': [
    'Acidente Vascular Cerebral (AVC)',
    'Anemias',
    'Arboviroses',
    'Asma',
    'Cirrose e Complicações',
    'Diabetes Mellitus',
    'Distúrbios Ácido-Básicos',
    'Distúrbios Hidroelétricos',
    'Doença Pulmonar Obstrutiva Crônica (DPOC)',
    'Doença Renal Crônica',
    'Hipertensão Arterial Sistemática (HAS)',
    'Infecção pelo HIV',
    'Insuficiência Cardíaca (IC)',
    'Lesão Renal Aguda',
    'Pneumonias Adquiridas na Comunidade (PAC)',
    'Síndromes Coronarianas Agudas',
    'Tuberculose',
  ],
  'Ginecologia e Obstetrícia': [
    'Assistência Pré-natal',
    'Câncer de Colo Uterino',
    'Câncer de Mama',
    'Climatério',
    'Contracepção',
    'Ginecologia Endócrina',
    'HPV',
    'Incontinência Urinária',
    'Infecções Sexualmente Transmissíveis',
    'Menopausa',
    'Planejamento Familiar',
    'Prolapsos Pélvicos',
    'Puerpério',
    'Sangramento na Gestação (1ª e 2ª metades)',
    'Trabalho de Parto',
    'Vulvovaginites',
  ],
  'Medicina da Família e Comunidade (MFC)': [
    'Atenção Primária à Saúde',
    'Bioética',
    'Declaração de Óbito',
    'Doenças de Notificação Compulsória',
    'Epidemiologia',
    'Ética Médica',
    'Medicina Baseada em Evidências',
    'Método Clínico Centrado na Pessoa',
    'Níveis de Prevenção',
    'Saúde do Trabalhador',
    'Sistemas de Informação',
    'SUS',
    'Vigilância em Saúde',
  ],
  'Pediatria': [
    'Aleitamento Materno',
    'Alimentação Complementar',
    'Calendário Vacinal',
    'Desidratação',
    'Diarreia Aguda',
    'Doenças Exantemáticas',
    'Doenças Respiratórias',
    'Faringoamigdalites',
    'Infecção do Trato Urinário (UTI)',
    'Neonatologia',
    'Otites',
    'Puericultura',
    'Síndromes Glomerulares (Nefrótica e Nefrítica)',
  ],
};

/** Mapeamento assunto -> área do conhecimento (para Colorido Condicionados) */
const ASSUNTO_TO_AREA: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [area, assuntos] of Object.entries(ASSUNTOS_BY_AREA)) {
    for (const a of assuntos) map[a] = area;
  }
  return map;
})();

/** Lista de todos os assuntos (para seletor Colorido do card Condicionados) */
const ALL_ASSUNTOS = Object.keys(ASSUNTO_TO_AREA);

/** Cor de fundo por assunto = cor da área do conhecimento (Condicionados) */
const ASSUNTOS_COLORIDO_BG: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const assunto of ALL_ASSUNTOS) {
    const area = ASSUNTO_TO_AREA[assunto];
    if (area && AREAS_COLORIDO_BG[area]) map[assunto] = AREAS_COLORIDO_BG[area];
  }
  return map;
})();

const GRADUATE_RESIDENCY_TAGS = [
  'Acupuntura',
  'Anestesiologia',
  'Cirurgia Cardiovascular',
  'Cirurgia Geral',
  'Cirurgia Vascular',
  'Clínica Médica',
  'Dermatologia',
  'Genética Médica',
  'Ginecologia e Obstetrícia',
  'Homeopatia',
  'Infectologia',
  'Medicina de Emergência',
  'Medicina de Família e Comunidade',
  'Medicina de Tráfego',
  'Medicina do Trabalho',
  'Medicina Esportiva',
  'Medicina Física e Reabilitação',
  'Medicina Intensiva',
  'Medicina Legal e Perícia Médica',
  'Medicina Nuclear',
  'Medicina Preventiva e Social',
  'Neurocirurgia',
  'Neurologia',
  'Oftalmologia',
  'Ortopedia e Traumatologia',
  'Otorrinolaringologia',
  'Patologia',
  'Patologia Clínica / Medicina Laboratorial',
  'Pediatria',
  'Psiquiatria',
  'Radiologia e Diagnóstico por Imagem',
  'Radioterapia',
];

type AcademicStatus = 'student' | 'generalist' | 'resident' | 'specialist' | 'graduate' | null;

export default function DashboardPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    academic_status: null as AcademicStatus,
    academic_period: null as number | null,
    institution: '',
    teaching_methodology: null as string | null,
    residency_status: null as 'wants' | 'doing' | 'completed' | 'not_interested' | null,
    residency_name: '',
    residency_year: null as string | null,
    wants_new_residency_exam: null as 'Sim' | 'Não' | null,
    specialty_area: '',
    wants_another_residency: null as 'Sim' | 'Não' | null,
    intended_residency: '',
    wants_residency: null as 'Sim' | 'Não' | null,
    intended_residency_generalist: '',
    has_residency: null as 'Sim' | 'Não' | null,
    has_specific_interest: null as boolean | null,
    interests_tags: [] as string[],
    next_residency_interests: [] as string[],
  });
  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardError, setWizardError] = useState('');
  const [selectorColorido, setSelectorColorido] = useState<string[]>([]);
  const [selectorEnumerado, setSelectorEnumerado] = useState<string[]>([]);
  const [selectorSigla, setSelectorSigla] = useState<string[]>([]);
  const [condicionalColorido, setCondicionalColorido] = useState<string[]>([]);
  const [condicionalEnumerado, setCondicionalEnumerado] = useState<string[]>([]);
  const [condicionalSigla, setCondicionalSigla] = useState<string[]>([]);
  const [showGroqModal, setShowGroqModal] = useState(false);
  const [groqFile, setGroqFile] = useState<File | null>(null);
  const [groqLink, setGroqLink] = useState('');
  const [groqTranscribing, setGroqTranscribing] = useState(false);
  const [groqResult, setGroqResult] = useState<string | null>(null);
  const [groqError, setGroqError] = useState<string | null>(null);
  const [groqSizeMessage, setGroqSizeMessage] = useState<string | null>(null);
  const [groqGeminiInstruction, setGroqGeminiInstruction] = useState(
    'Transforme a transcrição em: (1) resumo em tópicos, (2) checklist de pontos-chave, (3) 10 flashcards (pergunta/resposta).'
  );
  const [groqGeminiLoading, setGroqGeminiLoading] = useState(false);
  const [groqGeminiResult, setGroqGeminiResult] = useState<string | null>(null);
  const [groqGeminiError, setGroqGeminiError] = useState<string | null>(null);
  const [showGroqModal2, setShowGroqModal2] = useState(false);

  /** Áreas selecionadas no Condicionantes Colorido → definem opções do Condicionados Colorido */
  const areasCondicionantesColorido = selectorColorido.filter((a) => AREAS_CONHECIMENTO_OPTIONS.includes(a));
  const assuntosCondicionadosColorido = areasCondicionantesColorido.flatMap((area) => ASSUNTOS_BY_AREA[area] ?? []);

  /** Áreas selecionadas no Condicionantes Enumerado ("Área (1)" → área) → definem opções do Condicionados Enumerado */
  const areasCondicionantesEnumerado = selectorEnumerado
    .map((t) => t.replace(/\s*\(\d+\)$/, '').trim())
    .filter((area) => AREAS_CONHECIMENTO_OPTIONS.includes(area));
  const assuntosCondicionadosEnumerado = areasCondicionantesEnumerado.flatMap((area) => ASSUNTOS_BY_AREA[area] ?? []);

  /** Áreas selecionadas no Condicionantes Sigla ("Área (CB)" → área) → definem opções do Condicionados Sigla */
  const areasCondicionantesSigla = selectorSigla
    .map((t) => (t.includes(' (') ? t.split(' (')[0].trim() : t))
    .filter((area) => AREAS_CONHECIMENTO_OPTIONS.includes(area));
  const assuntosCondicionadosSigla = areasCondicionantesSigla.flatMap((area) => ASSUNTOS_BY_AREA[area] ?? []);

  /** Filtra Condicionados Colorido quando Condicionantes Colorido muda */
  useEffect(() => {
    if (areasCondicionantesColorido.length === 0) {
      setCondicionalColorido([]);
      return;
    }
    setCondicionalColorido((prev) => prev.filter((a) => areasCondicionantesColorido.includes(ASSUNTO_TO_AREA[a] ?? '')));
  }, [selectorColorido.join(',')]);

  /** Filtra Condicionados Enumerado quando Condicionantes Enumerado muda */
  useEffect(() => {
    if (assuntosCondicionadosEnumerado.length === 0) {
      setCondicionalEnumerado([]);
      return;
    }
    const getBaseAssunto = (t: string) => (t.includes(' (') ? t.split(' (')[0].trim() : t);
    setCondicionalEnumerado((prev) => prev.filter((t) => assuntosCondicionadosEnumerado.includes(getBaseAssunto(t))));
  }, [selectorEnumerado.join(',')]);

  /** Filtra Condicionados Sigla quando Condicionantes Sigla muda */
  useEffect(() => {
    if (assuntosCondicionadosSigla.length === 0) {
      setCondicionalSigla([]);
      return;
    }
    const getBaseAssunto = (t: string) => (t.includes(' (') ? t.split(' (')[0].trim() : t);
    setCondicionalSigla((prev) => prev.filter((t) => assuntosCondicionadosSigla.includes(getBaseAssunto(t))));
  }, [selectorSigla.join(',')]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      router.push('/login');
      return;
    }

    // Verificar token usando endpoint de verificação
    fetch('/api/auth/verify', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
      .then(async (response) => {
        const data = await response.json();
        if (response.ok && data.valid) {
          setIsLoading(false);
          // Buscar perfil do usuário
          fetchUserProfile();
        } else {
          console.error('Token inválido:', data);
          localStorage.removeItem('token');
          document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          router.push('/login');
        }
      })
      .catch((error) => {
        // Network error (e.g. request aborted during Fast Refresh reload).
        // Do NOT remove the token — just show the page and let the user continue.
        console.warn('Verify request failed (network):', error);
        setIsLoading(false);
        fetchUserProfile();
      });
  }, [router]);

  const fetchUserProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/users/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUserProfile(data);
        // Inicializar wizardData com dados existentes
        setWizardData({
          academic_status: data.academic_status,
          academic_period: data.academic_period,
          institution: data.institution || '',
          teaching_methodology: data.teaching_methodology,
          residency_status: data.residency_status,
          residency_name: data.residency_name || '',
          residency_year: data.residency_year || null,
          wants_new_residency_exam: data.wants_new_residency_exam || null,
          specialty_area: data.specialty_area || '',
          wants_another_residency: data.wants_another_residency || null,
          intended_residency: data.intended_residency || '',
          wants_residency: data.wants_residency || null,
          intended_residency_generalist: data.intended_residency_generalist || '',
          has_residency: data.has_residency || null,
          has_specific_interest: data.interests_tags && data.interests_tags.length > 0 ? true : null,
          interests_tags: data.interests_tags || [],
          next_residency_interests: data.next_residency_interests || [],
        });
      }
    } catch (error) {
      console.error('Erro ao buscar perfil:', error);
    }
  };

  const handleWizardSubmit = async () => {
    setWizardLoading(true);
    setWizardError('');

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setWizardError('Não autorizado');
        setWizardLoading(false);
        return;
      }

      const payload: any = {
        academic_status: wizardData.academic_status,
      };

      if (wizardData.academic_status === 'student') {
        payload.academic_period = wizardData.academic_period;
        payload.institution = wizardData.institution || null;
        payload.teaching_methodology = wizardData.teaching_methodology;
        payload.residency_status = null;
        // Para estudantes, salvar tags de interesse apenas se tiver interesse específico
        if (wizardData.has_specific_interest === true) {
          payload.interests_tags = wizardData.interests_tags.slice(0, 5);
        } else {
          payload.interests_tags = [];
        }
      } else {
        payload.academic_period = null;
        payload.institution = null;
        payload.teaching_methodology = null;
        // Para médicos, salvar o status de residência
        payload.residency_status = wizardData.residency_status;
        // Se for médico residente, salvar informações específicas da residência
        if (wizardData.academic_status === 'resident') {
          payload.residency_name = wizardData.residency_name || null;
          payload.residency_year = wizardData.residency_year || null;
          payload.wants_new_residency_exam = wizardData.wants_new_residency_exam || null;
          payload.next_residency_interests = wizardData.wants_new_residency_exam === 'Sim' ? (wizardData.next_residency_interests || []) : [];
          payload.specialty_area = null;
          payload.wants_another_residency = null;
          payload.intended_residency = null;
          payload.wants_residency = null;
          payload.intended_residency_generalist = null;
        } else if (wizardData.academic_status === 'specialist') {
          // Se for médico especialista, salvar informações de especialidade
          payload.specialty_area = wizardData.specialty_area || null;
          payload.wants_another_residency = wizardData.wants_another_residency || null;
          payload.intended_residency = wizardData.intended_residency || null;
          payload.residency_name = null;
          payload.residency_year = null;
          payload.wants_new_residency_exam = null;
          payload.next_residency_interests = [];
          payload.wants_residency = null;
          payload.intended_residency_generalist = null;
        } else if (wizardData.academic_status === 'generalist') {
          // Se for médico generalista, salvar informações sobre residência
          payload.wants_residency = wizardData.wants_residency || null;
          payload.intended_residency_generalist = wizardData.intended_residency_generalist || null;
          payload.residency_name = null;
          payload.residency_year = null;
          payload.wants_new_residency_exam = null;
          payload.next_residency_interests = [];
          payload.specialty_area = null;
          payload.wants_another_residency = null;
          payload.intended_residency = null;
          payload.has_residency = null;
        } else if (wizardData.academic_status === 'graduate') {
          // Se for médico mestrando/doutorando, salvar informações baseadas na resposta
          payload.has_residency = wizardData.has_residency || null;
          if (wizardData.has_residency === 'Não') {
            // Fluxo similar a generalista
            payload.wants_residency = wizardData.wants_residency || null;
            payload.intended_residency_generalist = wizardData.intended_residency_generalist || null;
            payload.specialty_area = null;
            payload.wants_another_residency = null;
            payload.intended_residency = null;
          } else if (wizardData.has_residency === 'Sim') {
            // Fluxo similar a especialista
            payload.specialty_area = wizardData.specialty_area || null;
            payload.wants_another_residency = wizardData.wants_another_residency || null;
            payload.intended_residency = wizardData.intended_residency || null;
            payload.wants_residency = null;
            payload.intended_residency_generalist = null;
          }
          payload.residency_name = null;
          payload.residency_year = null;
          payload.wants_new_residency_exam = null;
          payload.next_residency_interests = [];
        } else {
          payload.residency_name = null;
          payload.residency_year = null;
          payload.wants_new_residency_exam = null;
          payload.next_residency_interests = [];
          payload.specialty_area = null;
          payload.wants_another_residency = null;
          payload.intended_residency = null;
          payload.wants_residency = null;
          payload.intended_residency_generalist = null;
          payload.has_residency = null;
          payload.next_residency_interests = [];
        }
        // Médicos não têm mais etapa de tags de interesse
        payload.interests_tags = null;
      }

      const response = await fetch('/api/users/me', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const updatedData = await response.json();
        setUserProfile(updatedData);
        setShowWizard(false);
        setWizardStep(1);
        alert('Perfil atualizado com sucesso!');
      } else {
        const error = await response.json();
        setWizardError(error.error || 'Erro ao atualizar perfil');
      }
    } catch (error) {
      setWizardError('Erro ao atualizar perfil. Tente novamente.');
    } finally {
      setWizardLoading(false);
    }
  };


  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Bem-vindo ao MedMind</h3>
          <p className="text-gray-600">
            Comece organizando seus estudos e cases clínicos.
          </p>
        </div>

        {/* Card "Te conhecendo melhor!" - Sempre visível */}
        <div 
          onClick={() => {
            // Carregar dados existentes ao abrir o wizard
                  if (userProfile) {
                    setWizardData({
                      academic_status: userProfile.academic_status as AcademicStatus,
                      academic_period: userProfile.academic_period,
                      institution: userProfile.institution || '',
                      teaching_methodology: userProfile.teaching_methodology,
                      residency_status: userProfile.residency_status,
                      residency_name: userProfile.residency_name || '',
                      residency_year: userProfile.residency_year || null,
                      wants_new_residency_exam: userProfile.wants_new_residency_exam || null,
                      specialty_area: userProfile.specialty_area || '',
                      wants_another_residency: userProfile.wants_another_residency || null,
                      intended_residency: userProfile.intended_residency || '',
                      wants_residency: userProfile.wants_residency || null,
                      intended_residency_generalist: userProfile.intended_residency_generalist || '',
                      has_residency: userProfile.has_residency || null,
                      has_specific_interest: userProfile.interests_tags && userProfile.interests_tags.length > 0 ? true : null,
                      interests_tags: userProfile.interests_tags || [],
                      next_residency_interests: userProfile.next_residency_interests || [],
                    });
              // Se já tem situação profissional, ir para a etapa apropriada
              if (userProfile.academic_status === 'student') {
                setWizardStep(2); // Sempre começar na etapa 2 (informações acadêmicas) para estudantes
              } else if (userProfile.academic_status && ['generalist', 'resident', 'specialist', 'graduate'].includes(userProfile.academic_status)) {
                // Se for médico, verificar tipo
                if (userProfile.academic_status === 'resident') {
                  // Se for residente, sempre ir para etapa 3 (informações específicas)
                  setWizardStep(3);
                } else if (userProfile.academic_status === 'specialist') {
                  // Se for especialista, sempre ir para etapa 3 (informações de especialidade)
                  setWizardStep(3);
                } else if (userProfile.academic_status === 'generalist') {
                  // Se for generalista, sempre ir para etapa 3 (informações sobre residência)
                  setWizardStep(3);
                } else if (userProfile.academic_status === 'graduate') {
                  // Se for mestrando/doutorando, verificar se já respondeu sobre ter residência
                  if (userProfile.has_residency) {
                    // Se já respondeu, ir para etapa 4
                    setWizardStep(4);
                  } else {
                    // Se não respondeu, ir para etapa 3
                    setWizardStep(3);
                  }
                } else {
                  // Se não for nenhum dos quatro, ir para etapa 2 (categoria de médico)
                  setWizardStep(2);
                }
              } else {
                setWizardStep(1);
              }
            }
            setShowWizard(true);
          }}
          className="bg-gradient-to-br from-primary-500 to-primary-600 p-6 rounded-lg shadow-lg cursor-pointer hover:shadow-xl transition-shadow"
        >
          <div className="flex items-center gap-3 mb-3">
            <GraduationCap className="w-8 h-8 text-white" />
            <h3 className="text-xl font-bold text-white">Te conhecendo melhor!</h3>
          </div>
          <p className="text-primary-50 text-sm">
            {userProfile?.academic_status 
              ? 'Edite seu perfil para atualizar suas informações'
              : 'Complete seu perfil para uma experiência personalizada'}
          </p>
        </div>

        {/* Card Teste Groq */}
        <div
          onClick={() => {
            setShowGroqModal(true);
            setGroqFile(null);
            setGroqLink('');
            setGroqResult(null);
            setGroqError(null);
          }}
          className="bg-white p-6 rounded-lg shadow border border-gray-200 cursor-pointer hover:shadow-md hover:border-primary-300 transition"
        >
          <div className="flex items-center gap-3 mb-3">
            <Mic className="w-8 h-8 text-primary-600" />
            <h3 className="text-xl font-bold text-gray-800">Teste Groq</h3>
          </div>
          <p className="text-gray-600 text-sm">
            Envie áudio, vídeo ou um link para transcrever com a API Groq (STT).
          </p>
        </div>

        {/* Card Teste Groq 2 */}
        <div
          onClick={() => setShowGroqModal2(true)}
          className="bg-white p-6 rounded-lg shadow border-4 border-primary-500 cursor-pointer hover:shadow-md hover:border-primary-600 transition"
        >
          <div className="flex items-center gap-3 mb-3">
            <Mic className="w-8 h-8 text-primary-600" />
            <h3 className="text-xl font-bold text-gray-800">Teste Groq 2</h3>
          </div>
          <p className="text-gray-600 text-sm">
            Envie áudio, vídeo ou um link para transcrever com a API Groq (STT).
          </p>
        </div>
      </div>

      {/* Modal Teste Groq */}
      {showGroqModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Teste Groq</h2>
              <button
                type="button"
                onClick={() => {
                  setShowGroqModal(false);
                  setGroqFile(null);
                  setGroqLink('');
                  setGroqResult(null);
                  setGroqError(null);
                  setGroqSizeMessage(null);
                  setGroqGeminiLoading(false);
                  setGroqGeminiResult(null);
                  setGroqGeminiError(null);
                }}
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Envie vídeos, imagens, áudios ou documentos, ou cole o link onde o material está disponível. A transcrição (STT) é feita apenas para áudio e vídeo.
              </p>
              <p className="text-xs text-primary-600 bg-primary-50 p-2 rounded">
                💡 <strong>Dica:</strong> Suporta links do Google Drive e OneDrive! Certifique-se de que o arquivo está configurado como "Qualquer pessoa com o link pode visualizar" ou "Público".
              </p>
              <p className="text-xs text-gray-500">
                Vídeos maiores que 25 MB são transcritos automaticamente em fragmentos (até 1000 MB). O áudio é baixado temporariamente, dividido em partes e cada parte é transcrita até a conclusão.
              </p>

              {/* Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Upload className="w-4 h-4 inline mr-1" />
                  Upload de arquivo
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-400 transition-colors">
                  <input
                    type="file"
                    accept="video/*,audio/*,image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setGroqFile(f || null);
                      setGroqResult(null);
                      setGroqError(null);
                      setGroqSizeMessage(null);
                      setGroqGeminiResult(null);
                      setGroqGeminiError(null);
                    }}
                    className="w-full text-sm text-gray-600 file:mr-2 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 file:font-medium"
                  />
                  {groqFile && (
                    <>
                      <p className="mt-2 text-sm text-gray-600">
                        Arquivo: {groqFile.name} ({(groqFile.size / 1024).toFixed(1)} KB)
                      </p>
                      {groqFile.size > 100 * 1024 * 1024 && (
                        <p className="mt-1 text-xs text-amber-600">
                          Arquivo grande. Em alguns servidores o upload pode falhar — para arquivos acima de ~100 MB, use o link do Google Drive/OneDrive.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Link */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <LinkIcon className="w-4 h-4 inline mr-1" />
                  Ou cole o link do material
                </label>
                <input
                  type="url"
                  value={groqLink}
                  onChange={(e) => {
                    setGroqLink(e.target.value);
                    setGroqResult(null);
                    setGroqError(null);
                    setGroqSizeMessage(null);
                    setGroqGeminiResult(null);
                    setGroqGeminiError(null);
                  }}
                  placeholder="https://..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Transcrever: habilitado para áudio/vídeo ou link */}
              {(() => {
                const isAudioOrVideo = groqFile && (groqFile.type.startsWith('audio/') || groqFile.type.startsWith('video/'));
                const hasLink = groqLink.trim().length > 0;
                const canTranscribe = isAudioOrVideo || hasLink;
                return (
                  <div>
                    <button
                      type="button"
                      disabled={!canTranscribe || groqTranscribing}
                      onClick={async () => {
                        setGroqError(null);
                        setGroqResult(null);
                        setGroqSizeMessage(null);
                        setGroqGeminiResult(null);
                        setGroqGeminiError(null);
                        setGroqTranscribing(true);
                        try {
                          const token = localStorage.getItem('token');
                          if (!token) {
                            setGroqError('Faça login para usar a transcrição.');
                            return;
                          }
                          const urlToCall = '/api/groq/transcribe-with-extract';
                          if (groqFile && (groqFile.type.startsWith('audio/') || groqFile.type.startsWith('video/'))) {
                            const formData = new FormData();
                            formData.append('file', groqFile);
                            const res = await fetch(urlToCall, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}` },
                              body: formData,
                            });
                            const text = await res.text();
                            let data: { error?: string; text?: string; originalSize?: number; extractedSize?: number };
                            try {
                              data = text ? JSON.parse(text) : {};
                            } catch {
                              setGroqError(
                                res.status === 413
                                  ? 'Arquivo muito grande para upload direto. Envie um arquivo menor (recomendado até 100 MB) ou use o link do arquivo no Google Drive/OneDrive.'
                                  : 'Resposta inválida do servidor. Se o arquivo for muito grande, tente um menor ou use o link do arquivo.'
                              );
                              return;
                            }
                            if (!res.ok) {
                              setGroqError(data.error || 'Erro ao transcrever.');
                              return;
                            }
                            const orig = data.originalSize ?? 0;
                            const extr = data.extractedSize ?? 0;
                            if (orig > 0 && extr < orig) {
                              const origMB = (orig / 1024 / 1024).toFixed(2);
                              const extrMB = (extr / 1024 / 1024).toFixed(2);
                              const diffMB = ((orig - extr) / 1024 / 1024).toFixed(2);
                              setGroqSizeMessage(`Tamanho do arquivo reduzido: de ${origMB} MB para ${extrMB} MB (economia de ${diffMB} MB).`);
                            }
                            setGroqResult(data.text || '');
                          } else if (groqLink.trim()) {
                            const res = await fetch(urlToCall, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({ url: groqLink.trim() }),
                            });
                            const text = await res.text();
                            let data: { error?: string; text?: string; originalSize?: number; extractedSize?: number };
                            try {
                              data = text ? JSON.parse(text) : {};
                            } catch {
                              setGroqError('Resposta inválida do servidor. O link pode ter retornado uma página em vez do arquivo — verifique se o arquivo do Google Drive está como "Qualquer pessoa com o link pode visualizar".');
                              return;
                            }
                            if (!res.ok) {
                              setGroqError(data.error || 'Erro ao transcrever.');
                              return;
                            }
                            const orig = data.originalSize ?? 0;
                            const extr = data.extractedSize ?? 0;
                            if (orig > 0 && extr < orig) {
                              const origMB = (orig / 1024 / 1024).toFixed(2);
                              const extrMB = (extr / 1024 / 1024).toFixed(2);
                              const diffMB = ((orig - extr) / 1024 / 1024).toFixed(2);
                              setGroqSizeMessage(`Tamanho do arquivo reduzido: de ${origMB} MB para ${extrMB} MB (economia de ${diffMB} MB).`);
                            }
                            setGroqResult(data.text || '');
                          }
                        } catch (err) {
                          setGroqError(err instanceof Error ? err.message : 'Erro ao transcrever.');
                        } finally {
                          setGroqTranscribing(false);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                      <Mic className="w-5 h-5" />
                      {groqTranscribing ? 'Transcrevendo...' : 'Transcrever'}
                    </button>
                    {!canTranscribe && (groqFile || groqLink) && (
                      <p className="mt-2 text-xs text-gray-500">
                        Selecione um arquivo de áudio ou vídeo, ou informe um link direto para áudio/vídeo.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Resultado / Erro */}
              {groqError && (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {groqError}
                </div>
              )}
              {groqSizeMessage && (
                <div className="p-4 rounded-lg bg-primary-50 border border-primary-200 text-primary-800 text-sm">
                  {groqSizeMessage}
                </div>
              )}
              {groqResult && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Transcrição:</p>
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {groqResult}
                  </div>
                </div>
              )}
              {groqResult && (
                <div className="pt-4 border-t border-gray-200 space-y-3">
                  <p className="text-sm font-medium text-gray-700">Agente Gemini (transformar transcrição)</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Instrução</label>
                    <textarea
                      value={groqGeminiInstruction}
                      onChange={(e) => setGroqGeminiInstruction(e.target.value)}
                      rows={4}
                      placeholder="Ex.: gere um resumo, checklist e flashcards..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={groqGeminiLoading || !groqGeminiInstruction.trim()}
                    onClick={async () => {
                      setGroqGeminiError(null);
                      setGroqGeminiResult(null);
                      setGroqGeminiLoading(true);
                      try {
                        const token = localStorage.getItem('token');
                        if (!token) {
                          setGroqGeminiError('Faça login para usar a transformação com Gemini.');
                          return;
                        }
                        const res = await fetch('/api/gemini/transform', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({
                            transcription: groqResult,
                            instruction: groqGeminiInstruction,
                          }),
                        });
                        const text = await res.text();
                        let data: { error?: string; text?: string };
                        try {
                          data = text ? JSON.parse(text) : {};
                        } catch {
                          setGroqGeminiError('Resposta inválida do servidor ao transformar com Gemini.');
                          return;
                        }
                        if (!res.ok) {
                          setGroqGeminiError(data.error || 'Erro ao transformar com Gemini.');
                          return;
                        }
                        setGroqGeminiResult(data.text || '');
                      } catch (err) {
                        setGroqGeminiError(err instanceof Error ? err.message : 'Erro ao transformar com Gemini.');
                      } finally {
                        setGroqGeminiLoading(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-black transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    {groqGeminiLoading ? 'Transformando...' : 'Transformar com Gemini'}
                  </button>

                  {groqGeminiError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                      {groqGeminiError}
                    </div>
                  )}
                  {groqGeminiResult && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">Transformação (Gemini):</p>
                      <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 text-sm whitespace-pre-wrap max-h-80 overflow-y-auto">
                        {groqGeminiResult}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ResumoAulasModal
        isOpen={showGroqModal2}
        onClose={() => setShowGroqModal2(false)}
        title="Teste Groq 2"
      />

      {/* Card Condicionantes - chip autocomplete */}
      <div className="mt-[500px] bg-white p-6 rounded-lg shadow border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Condicionantes</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <TagAutocomplete
              options={AREAS_CONHECIMENTO_OPTIONS}
              selectedTags={selectorColorido}
              onChange={setSelectorColorido}
              label="Colorido"
              placeholder="Selecione..."
              onSaveNewTag={() => {}}
            />
          </div>
          <div>
            <TagAutocomplete
              options={AREAS_CONHECIMENTO_OPTIONS.map((tag, index) => `${tag} (${index + 1})`)}
              selectedTags={selectorEnumerado}
              onChange={setSelectorEnumerado}
              label="Enumerado"
              placeholder="Selecione..."
              onSaveNewTag={() => {}}
            />
          </div>
          <div>
            <TagAutocomplete
              options={AREAS_CONHECIMENTO_OPTIONS.map((tag) => `${tag} (${AREAS_SIGLAS[tag] ?? tag})`)}
              selectedTags={selectorSigla}
              onChange={setSelectorSigla}
              label="Sigla"
              placeholder="Selecione..."
              onSaveNewTag={() => {}}
            />
          </div>
        </div>
      </div>

      {/* Card Condicionados - opções vêm do card Condicionantes (Colorido→Colorido, Enumerado→Enumerado, Sigla→Sigla) */}
      <div className="mt-6 bg-white p-6 rounded-lg shadow border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Condicionados</h3>
        <p className="text-sm text-gray-500 mb-4">
          Selecione áreas no card Condicionantes acima; cada seletor aqui mostra os assuntos das áreas escolhidas no seletor correspondente.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className={assuntosCondicionadosColorido.length === 0 ? 'opacity-60 pointer-events-none' : ''}>
            <TagAutocomplete
              options={assuntosCondicionadosColorido}
              selectedTags={condicionalColorido}
              onChange={setCondicionalColorido}
              label="Colorido (Assunto)"
              placeholder={assuntosCondicionadosColorido.length > 0 ? 'Selecione assuntos...' : 'Selecione áreas no Colorido (Condicionantes) primeiro'}
              onSaveNewTag={() => {}}
            />
          </div>
          <div className={assuntosCondicionadosEnumerado.length === 0 ? 'opacity-60 pointer-events-none' : ''}>
            <TagAutocomplete
              options={assuntosCondicionadosEnumerado.map((assunto) => {
                const area = ASSUNTO_TO_AREA[assunto];
                const numeroDaArea = area ? AREAS_CONHECIMENTO_OPTIONS.indexOf(area) + 1 : 0;
                return `${assunto} (${numeroDaArea})`;
              })}
              selectedTags={condicionalEnumerado}
              onChange={setCondicionalEnumerado}
              label="Enumerado (Assunto)"
              placeholder={assuntosCondicionadosEnumerado.length > 0 ? 'Selecione um assunto...' : 'Selecione áreas no Enumerado (Condicionantes) primeiro'}
              onSaveNewTag={() => {}}
            />
          </div>
          <div className={assuntosCondicionadosSigla.length === 0 ? 'opacity-60 pointer-events-none' : ''}>
            <TagAutocomplete
              options={assuntosCondicionadosSigla.map((assunto) => `${assunto} (${AREAS_SIGLAS[ASSUNTO_TO_AREA[assunto]] ?? ''})`)}
              selectedTags={condicionalSigla}
              onChange={setCondicionalSigla}
              label="Sigla (Assunto)"
              placeholder={assuntosCondicionadosSigla.length > 0 ? 'Selecione um assunto...' : 'Selecione áreas no Sigla (Condicionantes) primeiro'}
              onSaveNewTag={() => {}}
            />
          </div>
        </div>
      </div>

      {/* Card Teste Groq 3 - mesmas funcionalidades que Teste Groq */}
      <div
        onClick={() => {
          setShowGroqModal(true);
          setGroqFile(null);
          setGroqLink('');
          setGroqResult(null);
          setGroqError(null);
          setGroqSizeMessage(null);
          setGroqGeminiResult(null);
          setGroqGeminiError(null);
        }}
        className="mt-6 bg-white p-6 rounded-lg shadow border border-gray-200 cursor-pointer hover:shadow-md hover:border-primary-300 transition"
      >
        <div className="flex items-center gap-3 mb-3">
          <Mic className="w-8 h-8 text-primary-600" />
          <h3 className="text-xl font-bold text-gray-800">Teste Groq 3</h3>
        </div>
        <p className="text-gray-600 text-sm">
          Envie áudio, vídeo ou um link para transcrever com a API Groq (STT). Mesmas funcionalidades do Teste Groq.
        </p>
      </div>

      {/* Modal do Wizard */}
      {showWizard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">Te conhecendo melhor!</h2>
              <button
                onClick={() => {
                  setShowWizard(false);
                  setWizardStep(1);
                  setWizardError('');
                  // Restaurar dados originais
                  if (userProfile) {
                    setWizardData({
                      academic_status: userProfile.academic_status,
                      academic_period: userProfile.academic_period,
                      institution: userProfile.institution || '',
                      teaching_methodology: userProfile.teaching_methodology,
                      residency_status: userProfile.residency_status,
                      residency_name: userProfile.residency_name || '',
                      residency_year: userProfile.residency_year || null,
                      wants_new_residency_exam: userProfile.wants_new_residency_exam || null,
                      specialty_area: userProfile.specialty_area || '',
                      wants_another_residency: userProfile.wants_another_residency || null,
                      intended_residency: userProfile.intended_residency || '',
                      wants_residency: userProfile.wants_residency || null,
                      intended_residency_generalist: userProfile.intended_residency_generalist || '',
                      has_residency: userProfile.has_residency || null,
                      has_specific_interest: userProfile.interests_tags && userProfile.interests_tags.length > 0 ? true : null,
                      interests_tags: userProfile.interests_tags || [],
                      next_residency_interests: userProfile.next_residency_interests || [],
                    });
                  } else {
                    // Resetar para valores padrão
                    setWizardData({
                      academic_status: null,
                      academic_period: null,
                      institution: '',
                      teaching_methodology: null,
                      residency_status: null,
                      residency_name: '',
                      residency_year: null,
                      wants_new_residency_exam: null,
                      specialty_area: '',
                      wants_another_residency: null,
                      intended_residency: '',
                      wants_residency: null,
                      intended_residency_generalist: '',
                      has_residency: null,
                      has_specific_interest: null,
                      interests_tags: [],
                      next_residency_interests: [],
                    });
                  }
                }}
                className="p-2 rounded-full hover:bg-gray-100 transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-24">
              {/* Indicador de progresso */}
              <div className="flex items-center justify-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  wizardStep >= 1 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  1
                </div>
                <div className={`w-12 h-1 ${wizardStep >= 2 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  wizardStep >= 2 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  2
                </div>
                {wizardData.academic_status === 'student' && (
                  <>
                    <div className={`w-12 h-1 ${wizardStep >= 3 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                      wizardStep >= 3 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      3
                    </div>
                    {wizardData.has_specific_interest === true && (
                      <>
                        <div className={`w-12 h-1 ${wizardStep >= 4 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                          wizardStep >= 4 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                        }`}>
                          4
                        </div>
                      </>
                    )}
                  </>
                )}
                {wizardData.academic_status && wizardData.academic_status !== 'student' && 
                 ['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status) && (
                  <>
                    {(wizardData.academic_status === 'resident' || wizardData.academic_status === 'specialist' || wizardData.academic_status === 'generalist' || wizardData.academic_status === 'graduate') && (
                      <>
                        <div className={`w-12 h-1 ${wizardStep >= 3 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                          wizardStep >= 3 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                        }`}>
                          3
                        </div>
                      </>
                    )}
                    {wizardData.academic_status === 'graduate' && wizardData.has_residency !== null && (
                      <>
                        <div className={`w-12 h-1 ${wizardStep >= 4 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                          wizardStep >= 4 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                        }`}>
                          4
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Etapa 1 - Situação profissional */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Qual a sua situação profissional?
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Esta informação é opcional</p>
                    
                    <div className="space-y-3">
                      <label
                        className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition ${
                          wizardData.academic_status === 'student'
                            ? 'border-primary-600 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="academic_status"
                          value="student"
                          checked={wizardData.academic_status === 'student'}
                          onChange={(e) => {
                            setWizardData({ 
                              ...wizardData, 
                              academic_status: 'student',
                            });
                          }}
                          className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="ml-3 text-gray-700">Estudante de Medicina</span>
                      </label>
                      
                      <label
                        className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition ${
                          wizardData.academic_status && ['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status)
                            ? 'border-primary-600 bg-primary-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="academic_status"
                          value="doctor"
                          checked={!!(wizardData.academic_status && ['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status))}
                          onChange={(e) => {
                            // Usar 'generalist' como valor temporário para identificar que é médico
                            setWizardData({ 
                              ...wizardData, 
                              academic_status: 'generalist',
                            });
                          }}
                          className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="ml-3 text-gray-700">Médico</span>
                      </label>
                    </div>
                  </div>

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 2 - Categoria de médico */}
              {wizardStep === 2 && wizardData.academic_status !== 'student' && 
               ['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status || '') && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Qual a categoria de médico você é?
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Esta informação é opcional</p>
                    
                    <div className="space-y-3">
                      {[
                        { value: 'generalist', label: 'Médico Generalista/Plantonista' },
                        { value: 'resident', label: 'Médico Residente' },
                        { value: 'specialist', label: 'Médico Especialista' },
                        { value: 'graduate', label: 'Médico Mestrando/Doutorando' },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition ${
                            wizardData.academic_status === option.value
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="doctor_category"
                            value={option.value}
                            checked={wizardData.academic_status === option.value}
                            onChange={(e) => {
                              const newStatus = e.target.value as AcademicStatus;
                              setWizardData({ 
                                ...wizardData, 
                                academic_status: newStatus,
                              });
                            }}
                            className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="ml-3 text-gray-700">{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 2 - Informações acadêmicas do estudante */}
              {wizardStep === 2 && wizardData.academic_status === 'student' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações Acadêmicas
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Em que período do curso você está?
                    </label>
                    <select
                      value={wizardData.academic_period || ''}
                      onChange={(e) => {
                        const period = e.target.value ? parseInt(e.target.value) : null;
                        setWizardData({ ...wizardData, academic_period: period });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione o período</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((num) => (
                        <option key={num} value={num}>
                          {num}º Período
                        </option>
                      ))}
                    </select>
                    
                    {/* Mensagem informativa do ciclo */}
                    {wizardData.academic_period && (
                      <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded-lg">
                        <p className="text-sm text-gray-700">
                          <span className="font-semibold">Ciclo identificado:</span>{' '}
                          {wizardData.academic_period >= 1 && wizardData.academic_period <= 4 && (
                            <span className="text-blue-700">Ciclo Básico</span>
                          )}
                          {wizardData.academic_period >= 5 && wizardData.academic_period <= 8 && (
                            <span className="text-green-700">Ciclo Clínico</span>
                          )}
                          {wizardData.academic_period >= 9 && wizardData.academic_period <= 12 && (
                            <span className="text-purple-700">Internato</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Em que instituição você estuda?
                    </label>
                    <input
                      type="text"
                      value={wizardData.institution}
                      onChange={(e) => setWizardData({ ...wizardData, institution: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Universidade/Faculdade ..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Qual a metodologia de ensino adotada?
                    </label>
                    <select
                      value={wizardData.teaching_methodology || ''}
                      onChange={(e) => setWizardData({ ...wizardData, teaching_methodology: e.target.value || null })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione a metodologia</option>
                      <option value="traditional">Tradicional</option>
                      <option value="pbl">PBL (Project Based Learning)</option>
                      <option value="mixed">Mista</option>
                      <option value="other">Outra</option>
                    </select>
                  </div>

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}


              {/* Etapa 3 - Informações para médicos generalistas */}
              {wizardStep === 3 && wizardData.academic_status === 'generalist' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações sobre residência
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pretende prestar uma residência?
                    </label>
                    <select
                      value={wizardData.wants_residency || ''}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setWizardData({ 
                          ...wizardData, 
                          wants_residency: value as 'Sim' | 'Não' | null,
                          // Limpar intended_residency_generalist se selecionar "Não"
                          intended_residency_generalist: value === 'Não' ? '' : wizardData.intended_residency_generalist
                        });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione uma opção</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {wizardData.wants_residency === 'Sim' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Qual residência você quer prestar?
                      </label>
                      <TagAutocomplete
                        options={GRADUATE_RESIDENCY_TAGS}
                        selectedTags={wizardData.intended_residency_generalist ? [wizardData.intended_residency_generalist] : []}
                        onChange={(tags) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency_generalist: tags.length > 0 ? tags[0] : ''
                          });
                        }}
                        onSaveNewTag={(newTag) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency_generalist: newTag
                          });
                        }}
                        placeholder="Digite para buscar ou selecione uma residência..."
                        maxTags={1}
                      />
                    </div>
                  )}

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 3 - Informações específicas para médicos especialistas */}
              {wizardStep === 3 && wizardData.academic_status === 'specialist' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações sobre sua especialidade
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Qual a sua área de especialidade?
                    </label>
                    <TagAutocomplete
                      options={GRADUATE_RESIDENCY_TAGS}
                      selectedTags={wizardData.specialty_area ? [wizardData.specialty_area] : []}
                      onChange={(tags) => {
                        setWizardData({ 
                          ...wizardData, 
                          specialty_area: tags.length > 0 ? tags[0] : ''
                        });
                      }}
                      onSaveNewTag={(newTag) => {
                        setWizardData({ 
                          ...wizardData, 
                          specialty_area: newTag
                        });
                      }}
                      placeholder="Digite para buscar ou selecione uma especialidade..."
                      maxTags={1}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pretende fazer outra residência?
                    </label>
                    <select
                      value={wizardData.wants_another_residency || ''}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setWizardData({ 
                          ...wizardData, 
                          wants_another_residency: value as 'Sim' | 'Não' | null,
                          // Limpar intended_residency se selecionar "Não"
                          intended_residency: value === 'Não' ? '' : wizardData.intended_residency
                        });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione uma opção</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {wizardData.wants_another_residency === 'Sim' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Qual residência pretende prestar?
                      </label>
                      <TagAutocomplete
                        options={[]}
                        selectedTags={wizardData.intended_residency ? [wizardData.intended_residency] : []}
                        onChange={(tags) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency: tags.length > 0 ? tags[0] : ''
                          });
                        }}
                        onSaveNewTag={(newTag) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency: newTag
                          });
                        }}
                        placeholder="Digite a residência que pretende prestar..."
                        maxTags={1}
                      />
                    </div>
                  )}

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 3 - Informações para médicos mestrandos/doutorandos */}
              {wizardStep === 3 && wizardData.academic_status === 'graduate' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações sobre residência
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Já possui residência?
                    </label>
                    <select
                      value={wizardData.has_residency || ''}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setWizardData({ 
                          ...wizardData, 
                          has_residency: value as 'Sim' | 'Não' | null,
                          // Limpar campos dependendo da resposta
                          specialty_area: value === 'Não' ? '' : wizardData.specialty_area,
                          wants_another_residency: value === 'Não' ? null : wizardData.wants_another_residency,
                          intended_residency: value === 'Não' ? '' : wizardData.intended_residency,
                          wants_residency: value === 'Sim' ? null : wizardData.wants_residency,
                          intended_residency_generalist: value === 'Sim' ? '' : wizardData.intended_residency_generalist
                        });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione uma opção</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 4 - Para mestrandos/doutorandos que NÃO têm residência (similar a generalista) */}
              {wizardStep === 4 && wizardData.academic_status === 'graduate' && wizardData.has_residency === 'Não' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações sobre residência
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pretende prestar uma residência?
                    </label>
                    <select
                      value={wizardData.wants_residency || ''}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setWizardData({ 
                          ...wizardData, 
                          wants_residency: value as 'Sim' | 'Não' | null,
                          // Limpar intended_residency_generalist se selecionar "Não"
                          intended_residency_generalist: value === 'Não' ? '' : wizardData.intended_residency_generalist
                        });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione uma opção</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {wizardData.wants_residency === 'Sim' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Qual residência você quer prestar?
                      </label>
                      <TagAutocomplete
                        options={GRADUATE_RESIDENCY_TAGS}
                        selectedTags={wizardData.intended_residency_generalist ? [wizardData.intended_residency_generalist] : []}
                        onChange={(tags) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency_generalist: tags.length > 0 ? tags[0] : ''
                          });
                        }}
                        onSaveNewTag={(newTag) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency_generalist: newTag
                          });
                        }}
                        placeholder="Digite para buscar ou selecione uma residência..."
                        maxTags={1}
                      />
                    </div>
                  )}

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 4 - Para mestrandos/doutorandos que JÁ têm residência (similar a especialista) */}
              {wizardStep === 4 && wizardData.academic_status === 'graduate' && wizardData.has_residency === 'Sim' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações sobre sua especialidade
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Qual a sua área de especialidade?
                    </label>
                    <TagAutocomplete
                      options={GRADUATE_RESIDENCY_TAGS}
                      selectedTags={wizardData.specialty_area ? [wizardData.specialty_area] : []}
                      onChange={(tags) => {
                        setWizardData({ 
                          ...wizardData, 
                          specialty_area: tags.length > 0 ? tags[0] : ''
                        });
                      }}
                      onSaveNewTag={(newTag) => {
                        setWizardData({ 
                          ...wizardData, 
                          specialty_area: newTag
                        });
                      }}
                      placeholder="Digite para buscar ou selecione uma especialidade..."
                      maxTags={1}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pretende fazer outra residência?
                    </label>
                    <select
                      value={wizardData.wants_another_residency || ''}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setWizardData({ 
                          ...wizardData, 
                          wants_another_residency: value as 'Sim' | 'Não' | null,
                          // Limpar intended_residency se selecionar "Não"
                          intended_residency: value === 'Não' ? '' : wizardData.intended_residency
                        });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione uma opção</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {wizardData.wants_another_residency === 'Sim' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Qual residência pretende prestar?
                      </label>
                      <TagAutocomplete
                        options={[]}
                        selectedTags={wizardData.intended_residency ? [wizardData.intended_residency] : []}
                        onChange={(tags) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency: tags.length > 0 ? tags[0] : ''
                          });
                        }}
                        onSaveNewTag={(newTag) => {
                          setWizardData({ 
                            ...wizardData, 
                            intended_residency: newTag
                          });
                        }}
                        placeholder="Digite a residência que pretende prestar..."
                        maxTags={1}
                      />
                    </div>
                  )}

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 3 - Informações específicas para médicos residentes */}
              {wizardStep === 3 && wizardData.academic_status === 'resident' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Informações sobre sua residência
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Estas informações são opcionais</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Qual a sua residência?
                    </label>
                    <TagAutocomplete
                      options={GRADUATE_RESIDENCY_TAGS}
                      selectedTags={wizardData.residency_name ? [wizardData.residency_name] : []}
                      onChange={(tags) => {
                        setWizardData({ 
                          ...wizardData, 
                          residency_name: tags.length > 0 ? tags[0] : ''
                        });
                      }}
                      onSaveNewTag={(newTag) => {
                        setWizardData({ 
                          ...wizardData, 
                          residency_name: newTag
                        });
                      }}
                      placeholder="Digite para buscar ou selecione uma residência..."
                      maxTags={1}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Qual o seu ano?
                    </label>
                    <select
                      value={wizardData.residency_year || ''}
                      onChange={(e) => {
                        const year = e.target.value || null;
                        setWizardData({ ...wizardData, residency_year: year });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione o ano</option>
                      {Array.from({ length: 8 }, (_, i) => i + 1).map((num) => (
                        <option key={num} value={`R${num}`}>
                          R{num}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pretende fazer nova prova de residência?
                    </label>
                    <select
                      value={wizardData.wants_new_residency_exam || ''}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setWizardData({ 
                          ...wizardData, 
                          wants_new_residency_exam: value as 'Sim' | 'Não' | null,
                          // Limpar áreas de interesse se selecionar "Não"
                          next_residency_interests: value === 'Sim' ? wizardData.next_residency_interests : []
                        });
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                    >
                      <option value="">Selecione uma opção</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {/* Pergunta sobre área de interesse da próxima residência - apenas se selecionar "Sim" */}
                  {wizardData.wants_new_residency_exam === 'Sim' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Qual a área de interesse da próxima residência?
                      </label>
                      <p className="text-xs text-gray-500 mb-3">Selecione as áreas de interesse (opcional)</p>
                      <TagAutocomplete
                        options={availableTags}
                        selectedTags={wizardData.next_residency_interests}
                        onChange={(tags) => {
                          setWizardData({ 
                            ...wizardData, 
                            next_residency_interests: tags
                          });
                        }}
                        onSaveNewTag={(newTag) => {
                          if (!availableTags.includes(newTag)) {
                            setAvailableTags([...availableTags, newTag]);
                          }
                        }}
                        placeholder="Digite para buscar áreas..."
                        maxTags={10}
                      />
                    </div>
                  )}

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}


              {/* Etapa 3 - Pergunta sobre interesse em área específica (apenas para estudantes) */}
              {wizardStep === 3 && wizardData.academic_status === 'student' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      Existe alguma área específica a qual você tem um interesse maior?
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">Esta informação é opcional</p>
                    
                    <div className="space-y-3">
                      {[
                        { value: true, label: 'Sim' },
                        { value: false, label: 'Não' },
                      ].map((option) => (
                        <label
                          key={String(option.value)}
                          className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition ${
                            wizardData.has_specific_interest === option.value
                              ? 'border-primary-600 bg-primary-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="has_specific_interest"
                            value={String(option.value)}
                            checked={wizardData.has_specific_interest === option.value}
                            onChange={(e) => {
                              const value = e.target.value === 'true';
                              setWizardData({ 
                                ...wizardData, 
                                has_specific_interest: value,
                                // Se selecionar "não", limpar as tags
                                interests_tags: value ? wizardData.interests_tags : []
                              });
                            }}
                            className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="ml-3 text-gray-700">{option.label}</span>
                        </label>
                      ))}
                    </div>

                    {/* Mensagem informativa quando selecionar "Não" */}
                    {wizardData.has_specific_interest === false && (
                      <div className="mt-4 p-4 bg-blue-50 border border-blue-300 rounded-lg">
                        <p className="text-sm text-gray-700">
                          Ao não selecionar uma opção você deixa o sistema com funcionamento padrão, lhe entregando informações contemplando todas as áreas da medicina.
                        </p>
                      </div>
                    )}
                  </div>

                  {wizardError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa 4 - Tags de interesse (para estudantes que selecionaram "sim") */}
              {wizardStep === 4 && wizardData.academic_status === 'student' && wizardData.has_specific_interest === true && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-2">
                        Áreas de interesse
                      </h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Selecione até 5 áreas de conhecimento que mais te interessam (opcional)
                      </p>
                      
                      <TagAutocomplete
                        options={availableTags}
                        selectedTags={wizardData.interests_tags ?? []}
                        onChange={(tags) => {
                          // Limitar a 5 tags
                          const limitedTags = tags.slice(0, 5);
                          setWizardData({ 
                            ...wizardData, 
                            interests_tags: limitedTags
                          });
                        }}
                        onSaveNewTag={(newTag) => {
                          if (!availableTags.includes(newTag)) {
                            setAvailableTags([...availableTags, newTag]);
                          }
                        }}
                        placeholder="Digite para buscar tags..."
                        maxTags={5}
                      />
                      
                      {(wizardData.interests_tags ?? []).length >= 5 && (
                        <p className="text-sm text-amber-600 mt-2">
                          Você selecionou o máximo de 5 tags
                        </p>
                      )}
                    </div>

                    {wizardError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                        {wizardError}
                      </div>
                    )}
                  </div>
              )}

            </div>

            {/* Footer fixo com botões */}
            <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4 bg-white rounded-b-2xl">
              {wizardStep === 1 && (
                <div className="flex gap-3">
                  {wizardData.academic_status && (
                    <button
                      type="button"
                      onClick={() => {
                        if (wizardData.academic_status === 'student') {
                          setWizardStep(2);
                        } else if (['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status || '')) {
                          setWizardStep(2);
                        }
                      }}
                      disabled={wizardLoading || !wizardData.academic_status}
                      className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                    >
                      Avançar
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {wizardStep === 2 && wizardData.academic_status !== 'student' && 
               ['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status || '') && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setWizardStep(1);
                      setWizardData({ ...wizardData, academic_status: null });
                    }}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (wizardData.academic_status && ['generalist', 'resident', 'specialist', 'graduate'].includes(wizardData.academic_status)) {
                        // Todos os tipos de médico vão para etapa 3
                        setWizardStep(3);
                      }
                    }}
                    disabled={wizardLoading || !wizardData.academic_status}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    Avançar
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {wizardStep === 2 && wizardData.academic_status === 'student' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWizardStep(3);
                    }}
                    disabled={wizardLoading}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    Avançar
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {wizardStep === 3 && wizardData.academic_status === 'generalist' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleWizardSubmit();
                    }}
                    disabled={wizardLoading}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardLoading ? 'Finalizando...' : 'Finalizar'}
                  </button>
                </div>
              )}

              {wizardStep === 3 && wizardData.academic_status === 'specialist' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleWizardSubmit();
                    }}
                    disabled={wizardLoading}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardLoading ? 'Finalizando...' : 'Finalizar'}
                  </button>
                </div>
              )}

              {wizardStep === 3 && wizardData.academic_status === 'graduate' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (wizardData.has_residency === 'Não') {
                        setWizardStep(4);
                      } else if (wizardData.has_residency === 'Sim') {
                        setWizardStep(4);
                      } else {
                        return;
                      }
                    }}
                    disabled={wizardLoading || !wizardData.has_residency}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardData.has_residency && (
                      <>
                        Avançar
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}

              {wizardStep === 4 && wizardData.academic_status === 'graduate' && wizardData.has_residency === 'Não' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleWizardSubmit();
                    }}
                    disabled={wizardLoading}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardLoading ? 'Finalizando...' : 'Finalizar'}
                  </button>
                </div>
              )}

              {wizardStep === 4 && wizardData.academic_status === 'graduate' && wizardData.has_residency === 'Sim' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleWizardSubmit();
                    }}
                    disabled={wizardLoading}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardLoading ? 'Finalizando...' : 'Finalizar'}
                  </button>
                </div>
              )}

              {wizardStep === 3 && wizardData.academic_status === 'resident' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleWizardSubmit();
                    }}
                    disabled={wizardLoading}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardLoading ? 'Finalizando...' : 'Finalizar'}
                  </button>
                </div>
              )}

              {wizardStep === 3 && wizardData.academic_status === 'student' && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (wizardData.has_specific_interest === true) {
                        setWizardStep(4);
                      } else if (wizardData.has_specific_interest === false) {
                        handleWizardSubmit();
                      }
                    }}
                    disabled={wizardLoading || wizardData.has_specific_interest === null}
                    className="flex items-center gap-2 flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardData.has_specific_interest === true ? (
                      <>
                        Avançar
                        <ChevronRight className="w-4 h-4" />
                      </>
                    ) : (
                      wizardLoading ? 'Finalizando...' : 'Finalizar'
                    )}
                  </button>
                </div>
              )}

              {wizardStep === 4 && wizardData.academic_status === 'student' && wizardData.has_specific_interest === true && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setWizardStep(3);
                    }}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={handleWizardSubmit}
                    disabled={wizardLoading}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
                  >
                    {wizardLoading ? 'Finalizando...' : 'Finalizar'}
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
