/**
 * Helpers para anexar imagens de questões às chamadas multimodais do Gemini.
 * As imagens em `questions.images` costumam ser data URLs (FileReader.readAsDataURL).
 */

export type GeminiSdkImagePart = {
  inlineData: { mimeType: string; data: string };
};

export type GeminiSdkTextPart = { text: string };

export type GeminiSdkPart = GeminiSdkTextPart | GeminiSdkImagePart;

export type GeminiRestImagePart = {
  inline_data: { mime_type: string; data: string };
};

export type GeminiRestTextPart = { text: string };

export type GeminiRestPart = GeminiRestTextPart | GeminiRestImagePart;

/** Limite defensivo de payload por chamada. */
export const MAX_QUESTION_IMAGES_FOR_GEMINI = 6;

/**
 * Instrução injetada no texto do usuário quando há imagens.
 * Garante o comportamento correto mesmo se o system prompt no DB ainda não foi atualizado.
 */
export const QUESTION_IMAGE_USER_GUIDANCE = [
  'Imagens da questão estão anexadas nesta mensagem.',
  'Interprete o conteúdo visual (exame, ECG, lesão, gráfico, figura diagnóstica etc.) e o papel dele no contexto da questão.',
  'Use essa interpretação apenas para apoiar a classificação/indexação (conceitos DeCS, temas, competências).',
  'NÃO resolva a questão nem escolha a alternativa correta — foque no que a imagem representa clinicamente.',
].join(' ');

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/i;

export function parseQuestionImages(raw: unknown): string[] {
  if (raw == null) return [];
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      // string única (data URL ou base64)
      return [trimmed];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, MAX_QUESTION_IMAGES_FOR_GEMINI);
}

export function parseImageSource(
  source: string,
): { mimeType: string; data: string } | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  const dataUrl = trimmed.match(DATA_URL_RE);
  if (dataUrl) {
    const mimeType = (dataUrl[1] || 'image/jpeg').toLowerCase();
    const data = dataUrl[2]?.replace(/\s/g, '') ?? '';
    if (!data) return null;
    if (!mimeType.startsWith('image/')) return null;
    return { mimeType, data };
  }

  // Base64 puro (sem prefixo data:)
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s/g, '').length > 64) {
    return { mimeType: 'image/jpeg', data: trimmed.replace(/\s/g, '') };
  }

  return null;
}

export function buildQuestionImageGuidance(imageCount: number): string {
  if (imageCount <= 0) return '';
  return `[Imagens anexadas: ${imageCount}]\n${QUESTION_IMAGE_USER_GUIDANCE}`;
}

function withImageGuidance(text: string, imageCount: number): string {
  if (imageCount <= 0) return text;
  const guidance = buildQuestionImageGuidance(imageCount);
  return [guidance, '', text].join('\n');
}

/**
 * Parts no formato do SDK `@google/genai` (camelCase).
 * Ordem: imagens primeiro, depois o texto (padrão multimodal recomendado).
 */
export function buildGeminiSdkUserParts(
  text: string,
  imagesRaw?: unknown,
  opts?: { includeGuidance?: boolean },
): GeminiSdkPart[] {
  const sources = parseQuestionImages(imagesRaw);
  const includeGuidance = opts?.includeGuidance !== false;
  const imageParts: GeminiSdkImagePart[] = [];

  for (const src of sources) {
    const parsed = parseImageSource(src);
    if (!parsed) continue;
    imageParts.push({
      inlineData: { mimeType: parsed.mimeType, data: parsed.data },
    });
  }

  const finalText = includeGuidance
    ? withImageGuidance(text, imageParts.length)
    : text;

  return [...imageParts, { text: finalText }];
}

/**
 * Parts no formato REST `generateContent` (snake_case).
 */
export function buildGeminiRestUserParts(
  text: string,
  imagesRaw?: unknown,
  opts?: { includeGuidance?: boolean },
): GeminiRestPart[] {
  const sources = parseQuestionImages(imagesRaw);
  const includeGuidance = opts?.includeGuidance !== false;
  const imageParts: GeminiRestImagePart[] = [];

  for (const src of sources) {
    const parsed = parseImageSource(src);
    if (!parsed) continue;
    imageParts.push({
      inline_data: { mime_type: parsed.mimeType, data: parsed.data },
    });
  }

  const finalText = includeGuidance
    ? withImageGuidance(text, imageParts.length)
    : text;

  return [...imageParts, { text: finalText }];
}
