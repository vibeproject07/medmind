import { cleanTranscriptionAgentOutput } from '@/lib/immediate-agent-output-cleaners';

export type ProcessingValidationKind = 'tokenizer' | 'chunking';

export type ProcessingValidationCheck = {
  key: string;
  label: string;
  ok: boolean;
  message: string;
};

export type ProcessingValidationReport = {
  kind: ProcessingValidationKind;
  valid: boolean;
  checks: ProcessingValidationCheck[];
};

type ValidationRun = {
  source_type?: string | null;
  processed_text?: string | null;
  cleaned_transcription?: string | null;
  cleaned_extraction_text?: string | null;
  transcription_segments?: unknown;
  tokenized_text?: unknown;
};

export type TokenizerServiceStatus = {
  available: boolean;
  maxTextCharacters?: number;
  maxTokens?: number;
  maxSentences?: number;
};

function report(
  kind: ProcessingValidationKind,
  checks: ProcessingValidationCheck[],
): ProcessingValidationReport {
  return { kind, valid: checks.every((check) => check.ok), checks };
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenizerText(run: ValidationRun): string {
  return String(
    run.cleaned_transcription ??
      run.cleaned_extraction_text ??
      run.processed_text ??
      '',
  );
}

export function validateTokenizerPrerequisites(
  run: ValidationRun | null,
  service: TokenizerServiceStatus,
): ProcessingValidationReport {
  const text = run ? tokenizerText(run) : '';
  const tokenization = run?.tokenized_text && typeof run.tokenized_text === 'object'
    ? run.tokenized_text as Record<string, unknown>
    : null;
  const tokenTotal = Number(tokenization?.token_total);
  const sentenceTotal = Number(tokenization?.sentence_total);
  const maxCharacters = service.maxTextCharacters;
  const maxTokens = service.maxTokens;
  const maxSentences = service.maxSentences;
  const transcriptionSource = run?.source_type === 'audio' || run?.source_type === 'video';
  const segments = Array.isArray(run?.transcription_segments)
    ? run.transcription_segments as Array<Record<string, unknown>>
    : [];
  const validSegments = segments.every((segment, index) => {
    const start = Number(segment.start);
    const end = Number(segment.end);
    const segmentText = typeof segment.text === 'string' ? normalized(segment.text) : '';
    const previousStart = index > 0 ? Number(segments[index - 1]?.start) : 0;
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 &&
      end > start && start >= previousStart && Boolean(segmentText);
  });
  const normalizedInput = normalized(text);
  const associatedSegments = segments.every((segment) => {
    const segmentText = typeof segment.text === 'string'
      ? normalized(cleanTranscriptionAgentOutput(segment.text))
      : '';
    return Boolean(segmentText) && normalizedInput.includes(segmentText);
  });

  const checks: ProcessingValidationCheck[] = [
    {
      key: 'run',
      label: 'Run de processamento',
      ok: Boolean(run),
      message: run ? 'Run atual encontrado.' : 'Nenhum run de processamento foi encontrado para a fonte.',
    },
    {
      key: 'service',
      label: 'Serviço spaCy',
      ok: service.available,
      message: service.available ? 'O serviço spaCy está disponível.' : 'O serviço spaCy não respondeu ao health check.',
    },
    {
      key: 'text',
      label: 'Texto de entrada',
      ok: Boolean(text.trim()),
      message: text.trim() ? 'O texto possui conteúdo tokenizável.' : 'A entrada está vazia.',
    },
    {
      key: 'characters',
      label: 'Limite de caracteres',
      ok: maxCharacters === undefined || text.length <= maxCharacters,
      message: maxCharacters === undefined
        ? `${text.length.toLocaleString('pt-BR')} caracteres; o serviço não informou seu limite.`
        : `${text.length.toLocaleString('pt-BR')} de ${maxCharacters.toLocaleString('pt-BR')} caracteres.`,
    },
    {
      key: 'tokens',
      label: 'Quantidade de tokens',
      ok: !Number.isFinite(tokenTotal) || maxTokens === undefined || tokenTotal <= maxTokens,
      message: Number.isFinite(tokenTotal)
        ? maxTokens === undefined
          ? `${tokenTotal.toLocaleString('pt-BR')} tokens persistidos; o serviço não informou seu limite.`
          : `${tokenTotal.toLocaleString('pt-BR')} de ${maxTokens.toLocaleString('pt-BR')} tokens.`
        : 'A quantidade exata será calculada pelo spaCy durante a tokenização.',
    },
    {
      key: 'sentences',
      label: 'Quantidade de frases',
      ok: !Number.isFinite(sentenceTotal) || maxSentences === undefined || sentenceTotal <= maxSentences,
      message: Number.isFinite(sentenceTotal)
        ? maxSentences === undefined
          ? `${sentenceTotal.toLocaleString('pt-BR')} frases persistidas; o serviço não informou seu limite.`
          : `${sentenceTotal.toLocaleString('pt-BR')} de ${maxSentences.toLocaleString('pt-BR')} frases.`
        : 'A quantidade exata será calculada pelo spaCy durante a tokenização.',
    },
  ];

  if (transcriptionSource) {
    checks.push(
      {
        key: 'segments',
        label: 'Segmentos temporais',
        ok: segments.length > 0 && validSegments,
        message: segments.length === 0
          ? 'A transcrição não possui segmentos temporais.'
          : validSegments
            ? `${segments.length} segmentos válidos e ordenados.`
            : 'Há segmentos sem texto, com tempos inválidos ou fora de ordem.',
      },
      {
        key: 'association',
        label: 'Associação texto–segmentos',
        ok: segments.length > 0 && associatedSegments,
        message: associatedSegments && segments.length > 0
          ? 'Todos os segmentos estão associados ao texto limpo.'
          : 'Um ou mais segmentos não foram localizados no texto limpo.',
      },
    );
  }

  return report('tokenizer', checks);
}

export function validateChunkingPrerequisites(
  run: ValidationRun | null,
  agentAvailable: boolean,
  providerAvailable: boolean,
): ProcessingValidationReport {
  const tokenization = run?.tokenized_text && typeof run.tokenized_text === 'object'
    ? run.tokenized_text as Record<string, unknown>
    : null;
  const sentences =
    (Array.isArray(tokenization?.chunking_sentences) && tokenization.chunking_sentences) ||
    (Array.isArray(tokenization?.sentences) && tokenization.sentences) ||
    (Array.isArray(tokenization?.sentences_in_text_order) && tokenization.sentences_in_text_order) ||
    [];
  const validSentences = sentences.every((raw, index) => {
    if (!raw || typeof raw !== 'object') return false;
    const sentence = raw as Record<string, unknown>;
    return Number(sentence.number) === index + 1 &&
      typeof sentence.text === 'string' &&
      Boolean(sentence.text.trim()) &&
      Number.isFinite(Number(sentence.start_char)) &&
      Number.isFinite(Number(sentence.end_char)) &&
      Number(sentence.end_char) >= Number(sentence.start_char) &&
      Array.isArray(sentence.unit_ids) &&
      Array.isArray(sentence.segment_ids);
  });

  return report('chunking', [
    {
      key: 'run',
      label: 'Run de processamento',
      ok: Boolean(run),
      message: run ? 'Run atual encontrado.' : 'Nenhum run de processamento foi encontrado para a fonte.',
    },
    {
      key: 'tokenization',
      label: 'Tokenização persistida',
      ok: Boolean(tokenization),
      message: tokenization ? 'A tokenização está disponível.' : 'Não há tokenização persistida para esta fonte.',
    },
    {
      key: 'sentences',
      label: 'Sentenças para chunking',
      ok: sentences.length > 0 && validSentences,
      message: sentences.length === 0
        ? 'O spaCy não produziu sentenças para o chunking.'
        : validSentences
          ? `${sentences.length} sentenças possuem IDs, offsets e unidades válidos.`
          : 'Há sentenças sem texto, com IDs, offsets ou unidades inválidos.',
    },
    {
      key: 'agent',
      label: 'Agente de chunking',
      ok: agentAvailable,
      message: agentAvailable
        ? 'O chunking_agent está ativo e possui instruções.'
        : 'O chunking_agent está ausente, inativo ou sem instruções.',
    },
    {
      key: 'provider',
      label: 'Provedor do agente',
      ok: providerAvailable,
      message: providerAvailable
        ? 'A configuração do provedor está disponível.'
        : 'GEMINI_API_KEY ou GOOGLE_API_KEY não está configurada.',
    },
  ]);
}