export interface AiAgentUsage {
  provider: 'Gemini' | 'Groq Whisper + ffmpeg' | 'Nenhum';
  routes: string[];
}

const AGENT_ROUTES: Record<string, string[]> = {
  broad_file_extraction: [
    '/api/gemini/process-document',
    '/api/gemini/process-link',
    '/api/gemini/transform',
    '/api/internal/note-source-worker',
  ],
  chunking_agent: [
    '/api/internal/note-source-worker',
    '/api/notes/[id]/sources/[sourceId]/validate',
  ],
  decs_classifier: [
    '/api/questions/[id]/decs-ai',
    '/api/admin/decs-batch-test',
  ],
  question_terms_validator: ['/api/questions/[id]/decs-ai'],
  decs_indexer_v2: ['/api/questions/[id]/decs-ai-v2'],
  decs_selector_v2: ['/api/questions/[id]/decs-ai-v2'],
  decs_validator: ['/api/questions/[id]/decs-ai'],
  habilities_agent: ['/api/questions/[id]/habilities'],
  question_themes_assigner: ['/api/questions/[id]/themes-assign'],
  discover_notes_terms: ['/api/notes/[id]/decs'],
  validate_notes_decs_terms: ['/api/notes/[id]/decs'],
  busca_vetorial: ['/api/questions/semantic-search'],
};

export const NON_AGENT_PROCESSORS = [
  {
    name: 'Transcrição de áudio, vídeo e YouTube',
    provider: 'Groq Whisper + ffmpeg',
    routes: [
      '/api/groq/transcribe',
      '/api/gemini/process-youtube',
      '/api/internal/note-source-worker',
    ],
  },
  {
    name: 'Extração de documentos, imagens e links',
    provider: 'Agente broad_file_extraction',
    routes: [
      '/api/gemini/process-document',
      '/api/gemini/process-link',
      '/api/internal/note-source-worker',
    ],
  },
] as const;

export function getAiAgentUsage(key: string): AiAgentUsage {
  const routes = AGENT_ROUTES[key] ?? [];
  return {
    provider: routes.length > 0 ? 'Gemini' : 'Nenhum',
    routes,
  };
}