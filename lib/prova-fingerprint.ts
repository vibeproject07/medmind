import { createHash } from 'crypto';

/** Normaliza texto para comparar conteúdo de questões (ordem + texto). */
export function normalizeProvaText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type FingerprintQuestion = {
  numero: number;
  statement: string;
  option_a: string;
  option_b: string;
  correct_answer: string;
};

/**
 * Assinatura da prova pela sequência completa de questões
 * (número + enunciado + A/B + gabarito). Ignora o nome da prova.
 */
export function computeProvaContentFingerprint(
  questions: FingerprintQuestion[],
): string {
  const parts = [...questions]
    .filter((q) => Number.isFinite(q.numero) && q.numero > 0)
    .sort((a, b) => a.numero - b.numero)
    .map((q) =>
      [
        String(q.numero),
        normalizeProvaText(q.statement),
        String(q.correct_answer || 'A')
          .toUpperCase()
          .trim()
          .slice(0, 1),
        normalizeProvaText(q.option_a),
        normalizeProvaText(q.option_b),
      ].join('|'),
    );

  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}
