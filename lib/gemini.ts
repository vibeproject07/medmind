import { GoogleGenAI, createUserContent, createPartFromUri, createPartFromText } from '@google/genai';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';

const DOCUMENT_INSTRUCTION_FALLBACK = `Leia o documento anexo e produza um resumo claro e organizado para estudo.
Preserve termos técnicos e pontos principais. Organize em tópicos e destaque o que for mais relevante.
Responda em português (pt-BR) e formate a saída em Markdown.`;

const IMAGE_INSTRUCTION_FALLBACK = `Descreva em detalhe a imagem anexa para uso em uma nota de estudo.
Inclua: elementos visíveis, qualquer texto presente, contexto, diagramas ou esquemas se houver, e relevância para estudo.
Preserve termos técnicos. Responda em português (pt-BR) e formate a saída em Markdown.`;

export const EXTRACT_TEXT_INSTRUCTION = `Extraia todo o texto do documento anexo, preservando a ordem e a estrutura (títulos, parágrafos, listas).
Não resuma nem interprete: retorne apenas o texto presente no arquivo. Use português (pt-BR) quando o conteúdo já estiver nesse idioma.`;

const SLIDES_INSTRUCTION_FALLBACK = `Analise a apresentação de slides anexa e produza um material de estudo.
Para cada slide: resuma o conteúdo e descreva elementos visuais importantes (gráficos, tabelas, imagens, diagramas).
Organize em tópicos por slide ou por tema. Preserve termos técnicos e pontos principais.
Responda em português (pt-BR) e formate a saída em Markdown.`;

function getFallbackInstructionByMimeType(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return IMAGE_INSTRUCTION_FALLBACK;
  if (
    m === 'application/vnd.ms-powerpoint' ||
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return SLIDES_INSTRUCTION_FALLBACK;
  }
  return DOCUMENT_INSTRUCTION_FALLBACK;
}

export type GeminiProcessDocumentParams = {
  file: Blob | Buffer;
  mimeType: string;
  apiKey?: string;
  model?: string;
  instruction?: string;
  agentKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export async function geminiProcessDocument({
  file,
  mimeType,
  apiKey,
  model,
  instruction,
  agentKey,
  temperature,
  maxOutputTokens,
}: GeminiProcessDocumentParams): Promise<string> {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }

  let effectiveInstruction = instruction;
  let effectiveTemperature = temperature ?? 0.2;
  let effectiveMaxTokens = maxOutputTokens ?? 4096;

  if (!effectiveInstruction && agentKey) {
    const runtimeAgent = await getRuntimeAgent(agentKey);
    effectiveInstruction = runtimeAgent.system_instruction;
    effectiveTemperature = temperature ?? runtimeAgent.temperature;
    effectiveMaxTokens = maxOutputTokens ?? runtimeAgent.max_output_tokens;
  }

  if (!effectiveInstruction) {
    effectiveInstruction = getFallbackInstructionByMimeType(mimeType);
  }

  const blob = Buffer.isBuffer(file) ? new Blob([file as any], { type: mimeType }) : file;
  const ai = new GoogleGenAI({ apiKey: key, apiVersion: 'v1beta' });

  const uploadedFile = await ai.files.upload({
    file: blob,
    config: { mimeType },
  });

  const fileName = uploadedFile.name ?? '';
  const fileMime = uploadedFile.mimeType ?? mimeType;
  if (!fileName) {
    throw new Error('Falha ao enviar o arquivo para o Gemini.');
  }

  const fileUri =
    fileName.startsWith('http')
      ? fileName
      : `https://generativelanguage.googleapis.com/v1beta/${fileName.startsWith('files/') ? fileName : `files/${fileName}`}`;

  for (let attempt = 0; attempt < 60; attempt++) {
    const fileInfo = await ai.files.get({ name: fileName });
    const state = (fileInfo as { state?: string })?.state ?? '';
    if (state === 'ACTIVE' || state === 'STATE_ACTIVE') break;
    if (state === 'FAILED' || state === 'STATE_FAILED') {
      throw new Error('O processamento do arquivo falhou no servidor.');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: createUserContent([
      createPartFromUri(fileUri, fileMime),
      createPartFromText(effectiveInstruction),
    ]),
    config: {
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
    },
  });

  const text = (response as any)?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();

  const alt = (response as any)?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
  if (typeof alt === 'string' && alt.trim()) return alt.trim();

  throw new Error('Resposta vazia do Gemini.');
}

const YOUTUBE_TRANSCRIPT_FALLBACK = `Transcreva o conteúdo falado deste vídeo do YouTube em português (pt-BR).
Preserve termos técnicos e siglas. Retorne apenas a transcrição do que é dito no vídeo, de forma contínua e organizada por tópicos quando fizer sentido.`;

export type GeminiProcessYouTubeParams = {
  url: string;
  apiKey?: string;
  model?: string;
  instruction?: string;
  agentKey?: string;
};

export async function geminiProcessYouTube({
  url,
  apiKey,
  model,
  instruction,
  agentKey,
}: GeminiProcessYouTubeParams): Promise<string> {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }

  let effectiveInstruction = instruction;
  let effectiveTemperature = 0.2;
  let effectiveMaxTokens = 8192;

  if (!effectiveInstruction && agentKey) {
    const runtimeAgent = await getRuntimeAgent(agentKey);
    effectiveInstruction = runtimeAgent.system_instruction;
    effectiveTemperature = runtimeAgent.temperature;
    effectiveMaxTokens = runtimeAgent.max_output_tokens;
  }

  if (!effectiveInstruction) {
    effectiveInstruction = YOUTUBE_TRANSCRIPT_FALLBACK;
  }

  const ai = new GoogleGenAI({ apiKey: key, apiVersion: 'v1beta' });

  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: createUserContent([
      createPartFromUri(url.trim(), 'video/mp4'),
      createPartFromText(effectiveInstruction),
    ]),
    config: {
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
    },
  });

  const text = (response as any)?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();

  const alt = (response as any)?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
  if (typeof alt === 'string' && alt.trim()) return alt.trim();

  throw new Error('Resposta vazia do Gemini.');
}

export type GeminiTransformTranscriptionParams = {
  transcription: string;
  instruction: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  apiKey?: string;
  systemPrompt?: string;
  agentKey?: string;
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

function buildPrompt(transcription: string, instruction: string, systemPrompt?: string) {
  if (systemPrompt && systemPrompt.trim()) {
    return [
      systemPrompt.trim(),
      '',
      '====================',
      'INSTRUÇÃO ESPECÍFICA',
      '====================',
      instruction.trim(),
      '',
      '====================',
      'CONTEÚDO',
      '====================',
      transcription.trim(),
    ].join('\n');
  }

  return [
    'Você é um agente especialista em transformar transcrições em materiais de estudo.',
    '',
    'Regras importantes:',
    '- Responda em português (pt-BR).',
    '- Não invente informações que não estejam na transcrição.',
    '- Se algo estiver ambíguo/incompleto, sinalize como "(não mencionado)".',
    '- Preserve termos médicos e siglas importantes.',
    '- Formate a saída em Markdown.',
    '',
    'Tarefa do usuário (instrução):',
    instruction.trim(),
    '',
    'Transcrição:',
    transcription.trim(),
  ].join('\n');
}

export async function geminiTransformTranscription({
  transcription,
  instruction,
  model,
  temperature,
  maxOutputTokens,
  apiKey,
  systemPrompt,
  agentKey,
}: GeminiTransformTranscriptionParams): Promise<string> {
  if (!transcription || !transcription.trim()) {
    throw new Error('Transcrição vazia.');
  }
  if (!instruction || !instruction.trim()) {
    throw new Error('Instrução vazia.');
  }

  const key = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }

  let effectiveSystemPrompt = systemPrompt;
  let effectiveTemperature = temperature;
  let effectiveMaxTokens = maxOutputTokens;

  if (!effectiveSystemPrompt && agentKey) {
    const runtimeAgent = await getRuntimeAgent(agentKey);
    effectiveSystemPrompt = runtimeAgent.system_instruction;
    effectiveTemperature = effectiveTemperature ?? runtimeAgent.temperature;
    effectiveMaxTokens = effectiveMaxTokens ?? runtimeAgent.max_output_tokens;
  }

  const ai = new GoogleGenAI({ apiKey: key, apiVersion: 'v1' });
  const prompt = buildPrompt(transcription, instruction, effectiveSystemPrompt);

  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: prompt,
    config: {
      temperature: effectiveTemperature ?? 0.2,
      maxOutputTokens: effectiveMaxTokens ?? 8192,
    },
  });

  const text = (response as any)?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();

  const alt = (response as any)?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? '';
  if (typeof alt === 'string' && alt.trim()) return alt.trim();

  throw new Error('Resposta vazia do Gemini.');
}
