/**
 * Mantém a rota antiga compatível, mas usa o mesmo pipeline completo da rota
 * com extração: vídeos viram áudio, arquivos grandes são segmentados e o
 * resultado preserva minutagens.
 */
export const runtime = 'nodejs';

export { POST } from '@/app/api/groq/transcribe-with-extract/route';