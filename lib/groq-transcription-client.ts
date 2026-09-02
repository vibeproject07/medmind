export interface TranscriptionProgress {
  stage: 'preparing' | 'extracting' | 'splitting' | 'transcribing';
  message: string;
  totalParts?: number;
  completedParts?: number;
  currentPart?: number;
  durationSeconds?: number;
  estimatedSecondsRemaining?: number;
}

export interface TranscriptionApiResult {
  text: string;
  rawText: string;
  segments: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    part: number;
  }>;
  language?: string;
  duration: number;
  partCount: number;
  originalSize: number;
  extractedSize: number;
  videoConvertedToAudio: boolean;
}

export interface LinkProcessingResult {
  text: string;
  originalText?: string;
  sourceType: 'audio' | 'video' | 'document' | 'image';
  filename: string;
  originalSize?: number;
  extractedSize?: number;
  videoConvertedToAudio?: boolean;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    part: number;
  }>;
  duration?: number;
  partCount?: number;
}

interface StreamEvent {
  type?: 'progress' | 'complete' | 'error';
  progress?: TranscriptionProgress;
  result?: TranscriptionApiResult;
  error?: string;
}

export async function transcribeWithProgress(
  body: FormData | { url: string },
  token: string,
  onProgress: (progress: TranscriptionProgress) => void,
): Promise<TranscriptionApiResult> {
  const isFormData = body instanceof FormData;
  const response = await fetch('/api/groq/transcribe-with-extract', {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      Authorization: `Bearer ${token}`,
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isFormData ? body : JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erro ao transcrever.');
  }
  if (!response.body) {
    throw new Error('O servidor não iniciou o fluxo de transcrição.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let finalResult: TranscriptionApiResult | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === 'progress' && event.progress) onProgress(event.progress);
    if (event.type === 'complete' && event.result) finalResult = event.result;
    if (event.type === 'error') throw new Error(event.error || 'Erro ao transcrever.');
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(pending);

  if (!finalResult) {
    throw new Error('A transcrição terminou sem retornar um resultado.');
  }
  return finalResult;
}

export async function processLinkWithProgress(
  url: string,
  token: string,
  onProgress: (progress: TranscriptionProgress) => void,
): Promise<LinkProcessingResult> {
  const response = await fetch('/api/gemini/process-link', {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erro ao processar o link.');
  }
  if (!response.body) throw new Error('O servidor não iniciou o processamento do link.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: LinkProcessingResult | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type?: 'progress' | 'complete' | 'error';
      progress?: TranscriptionProgress;
      result?: LinkProcessingResult;
      error?: string;
    };
    if (event.type === 'progress' && event.progress) onProgress(event.progress);
    if (event.type === 'complete' && event.result) result = event.result;
    if (event.type === 'error') throw new Error(event.error || 'Erro ao processar o link.');
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(pending);
  if (!result) throw new Error('O processamento do link terminou sem resultado.');
  return result;
}

export function formatEstimatedTime(seconds?: number): string {
  if (seconds === undefined || seconds <= 0) return 'menos de 1 minuto';
  if (seconds < 60) return 'menos de 1 minuto';
  const minutes = Math.ceil(seconds / 60);
  return `aproximadamente ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

export function describeTranscriptionProgress(progress: TranscriptionProgress): string {
  if (progress.stage !== 'transcribing' || !progress.totalParts) {
    return progress.message;
  }
  const partLabel =
    progress.totalParts > 1
      ? `O arquivo foi dividido em ${progress.totalParts} partes. `
      : '';
  const completed = progress.completedParts ?? 0;
  const progressLabel =
    completed >= progress.totalParts
      ? 'Transcrição concluída; consolidando as minutagens.'
      : `Transcrevendo parte ${progress.currentPart ?? completed + 1} de ${progress.totalParts}.`;
  return `${partLabel}${progressLabel} Tempo restante estimado: ${formatEstimatedTime(
    progress.estimatedSecondsRemaining,
  )}.`;
}