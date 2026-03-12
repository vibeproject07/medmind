/**
 * Cliente Groq Speech-to-Text (Whisper).
 * Documentação: https://console.groq.com/docs/speech-to-text
 * Suporta transcrição em fragmentos para arquivos maiores que o limite da API (25 MB).
 * ffmpeg é carregado apenas quando necessário (arquivos grandes), para não quebrar transcrições pequenas.
 */

import FormData from 'form-data';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Carrega ffmpeg apenas quando for transcrever arquivo grande (evita falha no import em alguns ambientes). */
async function getFfmpeg(): Promise<typeof import('fluent-ffmpeg')> {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  let ffmpegPath: string | null = null;

  try {
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
    if (ffmpegInstaller?.path) ffmpegPath = ffmpegInstaller.path;
  } catch (_e) {
    // @ffmpeg-installer pode falhar em caminhos com espaços ou ao resolver win32-x64
  }

  if (!ffmpegPath) {
    const platform = process.platform;
    const arch = process.arch === 'x64' ? 'x64' : process.arch;
    const dirName = platform === 'win32' ? 'win32-x64' : `${platform}-${arch}`;
    const exeName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidate = path.join(process.cwd(), 'node_modules', '@ffmpeg-installer', dirName, exeName);
    if (fs.existsSync(candidate)) ffmpegPath = candidate;
  }

  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    ffmpeg.setFfmpegPath('ffmpeg');
  }
  return ffmpeg;
}

/**
 * Extrai o file ID de uma URL do Google Drive (qualquer formato).
 */
function getGoogleDriveFileId(url: string): string | null {
  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) return fileIdMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return idMatch ? idMatch[1] : null;
}

/**
 * Converte URLs do Google Drive para links diretos de download.
 * Preferência: drive.usercontent.google.com (evita página de aviso de vírus em muitos casos).
 */
function convertGoogleDriveUrl(url: string): string {
  const fileId = getGoogleDriveFileId(url);
  if (fileId) {
    // Endpoint que costuma entregar o arquivo direto, inclusive para arquivos maiores
    return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  }
  if (url.includes('/uc?export=download') || url.includes('/uc?id=')) {
    return url;
  }
  return url;
}

/**
 * Expande shortlinks do OneDrive (1drv.ms) para a URL completa.
 */
async function expandOneDriveShortlink(shortUrl: string): Promise<string> {
  try {
    // Fazer uma requisição GET com maxRedirects para seguir todos os redirects
    // Usar maxRedirects alto e timeout para evitar travamentos
    const response = await axios.get(shortUrl, {
      maxRedirects: 10,
      timeout: 10000, // 10 segundos
      validateStatus: (status) => status < 500, // Aceitar redirects e sucesso
      // Não seguir redirects automaticamente, mas capturar a URL final
    });
    
    // Tentar obter a URL final de várias formas
    const finalUrl = 
      response.request?.responseURL || 
      response.request?.res?.responseUrl || 
      response.request?.res?.request?.res?.responseUrl ||
      response.config?.url ||
      shortUrl;
    
    // Se a URL final é diferente da original, retornar ela
    if (finalUrl !== shortUrl && finalUrl.includes('onedrive.live.com')) {
      return finalUrl;
    }
    
    // Se não conseguiu expandir, retornar original
    return shortUrl;
  } catch (error: any) {
    // Se o erro for um redirect (301, 302, etc.), tentar pegar a location header
    if (error.response?.status >= 300 && error.response?.status < 400) {
      const location = error.response.headers?.location;
      if (location) {
        return location;
      }
    }
    
    // Se falhar completamente, retornar URL original
    console.warn('Não foi possível expandir shortlink do OneDrive:', shortUrl, error.message);
    return shortUrl;
  }
}

/**
 * Converte URLs do OneDrive para links diretos de download.
 * Suporta vários formatos:
 * - https://onedrive.live.com/embed?resid=FILE_ID
 * - https://onedrive.live.com/?id=FILE_ID&cid=CID
 * - https://onedrive.live.com/download?resid=FILE_ID (já é direto)
 * - https://1drv.ms/... (shortlink, será expandido)
 */
async function convertOneDriveUrl(url: string): Promise<string> {
  // Se já é um link direto de download, retornar como está
  if (url.includes('/download?resid=')) {
    return url;
  }

  // Se for shortlink (1drv.ms), expandir primeiro
  if (url.includes('1drv.ms')) {
    url = await expandOneDriveShortlink(url);
  }

  // Padrão: /embed?resid=FILE_ID ou /?resid=FILE_ID
  const residMatch = url.match(/[?&]resid=([^&]+)/);
  if (residMatch) {
    const fileId = decodeURIComponent(residMatch[1]);
    return `https://onedrive.live.com/download?resid=${encodeURIComponent(fileId)}`;
  }

  // Padrão: /?id=FILE_ID
  const idMatch = url.match(/[?&]id=([^&]+)/);
  if (idMatch) {
    const fileId = decodeURIComponent(idMatch[1]);
    return `https://onedrive.live.com/download?resid=${encodeURIComponent(fileId)}`;
  }

  // Se não conseguir extrair, retornar URL original
  return url;
}

/**
 * Normaliza URLs de serviços de cloud storage para links diretos de download.
 */
export async function normalizeCloudStorageUrl(url: string): Promise<string> {
  const urlLower = url.toLowerCase();
  
  // Google Drive
  if (urlLower.includes('drive.google.com')) {
    return convertGoogleDriveUrl(url);
  }
  
  // OneDrive
  if (urlLower.includes('onedrive.live.com') || urlLower.includes('1drv.ms')) {
    return await convertOneDriveUrl(url);
  }
  
  // Dropbox (opcional, para futuro)
  if (urlLower.includes('dropbox.com')) {
    // Dropbox: converter ?dl=0 para ?dl=1
    if (url.includes('?dl=0')) {
      return url.replace('?dl=0', '?dl=1');
    }
    if (!url.includes('?dl=')) {
      return url + (url.includes('?') ? '&' : '?') + 'dl=1';
    }
  }
  
  // Retornar URL original se não for um serviço conhecido
  return url;
}

/** Verifica se a URL é de um serviço de cloud que retorna redirect (303) em vez do arquivo direto. */
export function isCloudStorageUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  return (
    urlLower.includes('drive.google.com') ||
    urlLower.includes('onedrive.live.com') ||
    urlLower.includes('1drv.ms') ||
    urlLower.includes('dropbox.com')
  );
}

const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25 MB (limite Groq por requisição)
/** Tamanho máximo para download/upload quando for usar transcrição em fragmentos (arquivo é baixado, dividido, transcrito por partes) */
export const MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION = 500 * 1024 * 1024; // 500 MB
/** Duração de cada fragmento em segundos (~7 min); mantém cada chunk abaixo de ~25 MB na maioria dos vídeos */
const CHUNK_DURATION_SECONDS = 420;
/** Alvo de tamanho por fragmento (deixe folga abaixo de 25MB) */
const MAX_CHUNK_BYTES_TARGET = 24 * 1024 * 1024; // 24 MB

/** Extensões aceitas pela API Groq STT */
const GROQ_ALLOWED_EXTENSIONS = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm'];

/**
 * Detecta o tipo de áudio/vídeo pelo conteúdo (magic bytes) e retorna uma extensão suportada pela Groq.
 */
function detectAudioVideoExtension(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  const b = buffer;

  // FLAC: fLaC
  if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'flac';
  // WAV: RIFF....WAVE
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56) return 'wav';
  // Ogg (OggS)
  if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';
  // WebM: 0x1A 0x45 0xDF 0xA3
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm';
  // ID3 (MP3)
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3';
  // MP3 frame sync
  if (b[0] === 0xFF && (b[1] === 0xFB || b[1] === 0xFA || b[1] === 0xF3 || b[1] === 0xF2)) return 'mp3';
  // MP4/M4A: ftyp em offset 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4';
  // MPEG-PS
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && (b[3] === 0xBA || b[3] === 0xB3)) return 'mpeg';

  return null;
}

/**
 * Garante que o nome do arquivo tenha uma extensão suportada pela Groq.
 */
function ensureSupportedFilename(buffer: Buffer, filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const hasAllowedExt = GROQ_ALLOWED_EXTENSIONS.includes(ext);
  if (hasAllowedExt) return filename;

  const detected = detectAudioVideoExtension(buffer);
  if (detected) {
    const base = filename.replace(/\.[^.]+$/, '') || 'audio';
    return `${base}.${detected}`;
  }

  // Fallback: usar .mp4 se o nome não tiver extensão (evita rejeitar arquivos válidos por detecção imperfeita)
  const base = filename.replace(/\.[^.]+$/, '') || 'audio';
  if (!ext || filename === base) {
    return `${base}.mp4`;
  }

  throw new Error(
    'Formato do arquivo não suportado pela transcrição. Use um dos formatos: MP4, MP3, WAV, WebM, M4A, OGG, FLAC, MPEG. ' +
    'Se o vídeo estiver em outro formato (ex.: MOV, AVI, MKV), converta para MP4 antes.'
  );
}

/**
 * Baixa o arquivo de uma URL seguindo redirects (incluindo 303 do Google Drive).
 * Retorna o buffer e um nome de arquivo com extensão suportada pela Groq.
 */
async function downloadFileFromUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    maxRedirects: 10,
    timeout: 60000, // 1 minuto para arquivos grandes
    maxContentLength: MAX_DOWNLOAD_SIZE,
    maxBodyLength: MAX_DOWNLOAD_SIZE,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const contentType = (response.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      'O link retornou uma página em vez do arquivo. Verifique se o arquivo está configurado como "Qualquer pessoa com o link pode visualizar". ' +
      'Arquivos muito grandes no Google Drive podem exigir confirmação de download; tente um arquivo menor ou faça upload direto.'
    );
  }

  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_DOWNLOAD_SIZE) {
    throw new Error(`Arquivo muito grande. Máximo ${MAX_DOWNLOAD_SIZE / 1024 / 1024} MB.`);
  }
  if (buffer.length === 0) {
    throw new Error('O arquivo baixado está vazio. Verifique se o link está correto e o arquivo é público.');
  }
  const start = buffer.slice(0, 200).toString('utf8').trimStart();
  if (start.startsWith('<') || start.startsWith('<!')) {
    throw new Error(
      'O link retornou uma página em vez do arquivo. Verifique se o arquivo está como "Qualquer pessoa com o link pode visualizar".'
    );
  }

  // Tentar obter nome do arquivo do header Content-Disposition
  let filename = 'audio';
  const contentDisposition = response.headers['content-disposition'];
  if (typeof contentDisposition === 'string') {
    const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"'\s;]+)["']?/i)
      || contentDisposition.match(/filename=["']?([^"'\s;]+)["']?/i);
    if (match?.[1]) {
      filename = decodeURIComponent(match[1].trim());
    }
  }
  // Fallback: extrair da URL
  if (filename === 'audio') {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split('/').filter(Boolean).pop();
      if (lastSegment && /\.(mp3|mp4|wav|webm|m4a|ogg|flac|mpeg|mpga|opus)$/i.test(lastSegment)) {
        filename = lastSegment;
      }
    } catch {
      // manter 'audio'
    }
  }

  // Garantir extensão suportada pela Groq (Google Drive muitas vezes envia "download" sem extensão)
  filename = ensureSupportedFilename(buffer, filename);
  return { buffer, filename };
}

const AXIOS_DOWNLOAD_OPTIONS = (maxSizeBytes: number) => ({
  responseType: 'arraybuffer' as const,
  maxRedirects: 10,
  timeout: 120000,
  maxContentLength: maxSizeBytes,
  maxBodyLength: maxSizeBytes,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  validateStatus: (status: number) => status >= 200 && status < 400,
});

/** Extrai o token "confirm" da página de aviso de vírus do Google Drive (HTML). */
function extractGoogleDriveConfirmToken(htmlBuffer: Buffer): string | null {
  const html = htmlBuffer.toString('utf8');
  const confirmMatch = html.match(/confirm=([a-zA-Z0-9_-]+)/);
  if (confirmMatch) return confirmMatch[1];
  const formMatch = html.match(/action="[^"]*export=download[^"]*confirm=([a-zA-Z0-9_-]+)/);
  if (formMatch) return formMatch[1];
  return null;
}

/** Verifica se o buffer parece ser HTML. */
function isHtmlResponse(buffer: Buffer): boolean {
  const start = buffer.slice(0, 200).toString('utf8').trimStart();
  return start.startsWith('<') || start.startsWith('<!');
}

/**
 * Baixa o arquivo de uma URL permitindo tamanho maior (para transcrição em fragmentos).
 * Para Google Drive: tenta usercontent; se receber HTML, tenta uc?export=download com token confirm.
 */
export async function downloadFileFromUrlLarge(
  url: string,
  maxSizeBytes: number = MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION
): Promise<{ buffer: Buffer; filename: string }> {
  let response = await axios.get(url, AXIOS_DOWNLOAD_OPTIONS(maxSizeBytes));
  let buffer = Buffer.from(response.data);

  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const isHtml = contentType.includes('text/html') || isHtmlResponse(buffer);

  if (isHtml && url.includes('google.com')) {
    const fileId = getGoogleDriveFileId(url) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1];
    if (fileId) {
      const classicUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const res2 = await axios.get(classicUrl, AXIOS_DOWNLOAD_OPTIONS(maxSizeBytes));
      buffer = Buffer.from(res2.data);
      if (!isHtmlResponse(buffer)) {
        response = res2;
      } else {
        const confirm = extractGoogleDriveConfirmToken(buffer);
        if (confirm) {
          const urlWithConfirm = `https://drive.google.com/uc?export=download&confirm=${confirm}&id=${fileId}`;
          const res3 = await axios.get(urlWithConfirm, AXIOS_DOWNLOAD_OPTIONS(maxSizeBytes));
          buffer = Buffer.from(res3.data);
          if (!isHtmlResponse(buffer)) {
            response = res3;
          }
        }
      }
    }
  }

  if (isHtmlResponse(buffer)) {
    throw new Error(
      'O Google Drive retornou uma página em vez do arquivo. Tente: 1) Abrir o link no navegador e baixar o arquivo manualmente, depois use "Upload de arquivo" aqui; ou 2) Use um link de compartilhamento direto com o arquivo em "Qualquer pessoa com o link pode visualizar".'
    );
  }

  if (buffer.length > maxSizeBytes) {
    throw new Error(`Arquivo muito grande. Máximo ${Math.round(maxSizeBytes / 1024 / 1024)} MB para transcrição em fragmentos.`);
  }
  if (buffer.length === 0) {
    throw new Error('O arquivo baixado está vazio.');
  }

  let filename = 'audio';
  const contentDisposition = response.headers['content-disposition'];
  if (typeof contentDisposition === 'string') {
    const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"'\s;]+)["']?/i)
      || contentDisposition.match(/filename=["']?([^"'\s;]+)["']?/i);
    if (match?.[1]) filename = decodeURIComponent(match[1].trim());
  }
  if (filename === 'audio') {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split('/').filter(Boolean).pop();
      if (lastSegment && /\.(mp3|mp4|wav|webm|m4a|ogg|flac|mpeg|mpga|opus)$/i.test(lastSegment)) filename = lastSegment;
    } catch { /* keep audio */ }
  }
  filename = ensureSupportedFilename(buffer, filename);
  return { buffer, filename };
}

/**
 * Extrai apenas o áudio de um vídeo (reduz o tamanho do arquivo).
 * Retorna o buffer do áudio, tamanho original, tamanho extraído e nome do arquivo de saída.
 */
export async function extractAudioFromVideo(
  fileBuffer: Buffer,
  filename: string
): Promise<{ audioBuffer: Buffer; originalSize: number; extractedSize: number; audioFilename: string }> {
  const originalSize = fileBuffer.length;
  const ffmpeg = await getFfmpeg();
  const tmpDir = path.join(os.tmpdir(), `groq-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const inputPath = path.join(tmpDir, filename.replace(/[^a-zA-Z0-9._-]/g, '_'));
  const outputPath = path.join(tmpDir, 'audio_extracted.mp3');

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(inputPath, fileBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Erro ao extrair áudio: ${err.message}`)))
        .run();
    });

    const audioBuffer = fs.readFileSync(outputPath);
    const extractedSize = audioBuffer.length;
    return {
      audioBuffer,
      originalSize,
      extractedSize,
      audioFilename: 'audio_extracted.mp3',
    };
  } finally {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.readdirSync(tmpDir).forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
        fs.rmdirSync(tmpDir);
      }
    } catch {
      // ignorar
    }
  }
}

/**
 * Verifica se o arquivo é vídeo pelo tipo MIME ou extensão.
 */
export function isVideoFile(filename: string, mimeType?: string): boolean {
  const type = (mimeType || '').toLowerCase();
  if (type.startsWith('video/')) return true;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ['mp4', 'webm', 'mpeg', 'mpg', 'mov', 'avi', 'mkv', 'm4v'].includes(ext);
}

/**
 * Divide um arquivo de mídia em fragmentos por duração (sem reencodar).
 * Retorna os caminhos dos arquivos de fragmento (temporários).
 */
async function splitMediaIntoChunks(
  inputPath: string,
  outputDir: string,
  segmentSeconds: number = CHUNK_DURATION_SECONDS
): Promise<string[]> {
  const ffmpeg = await getFfmpeg();
  const ext = path.extname(inputPath).slice(1) || 'mp4';
  const chunkPattern = path.join(outputDir, `chunk_%03d.${ext}`);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-f', 'segment',
        '-segment_time', String(segmentSeconds),
        '-reset_timestamps', '1',
        '-c', 'copy',
      ])
      .output(chunkPattern)
      .on('end', () => {
        const files = fs.readdirSync(outputDir)
          .filter((f) => f.startsWith('chunk_') && f.endsWith(`.${ext}`))
          .sort()
          .map((f) => path.join(outputDir, f));
        resolve(files);
      })
      .on('error', (err) => reject(new Error(`Erro ao dividir o vídeo: ${err.message}`)))
      .run();
  });
}

function deleteExistingChunks(outputDir: string, ext: string) {
  try {
    fs.readdirSync(outputDir)
      .filter((f) => f.startsWith('chunk_') && f.endsWith(`.${ext}`))
      .forEach((f) => {
        try {
          fs.unlinkSync(path.join(outputDir, f));
        } catch {
          // ignorar
        }
      });
  } catch {
    // ignorar
  }
}

async function splitMediaIntoChunksAdaptive(
  inputPath: string,
  outputDir: string
): Promise<string[]> {
  const ext = path.extname(inputPath).slice(1) || 'mp4';
  let segmentSeconds = CHUNK_DURATION_SECONDS;
  const minSegmentSeconds = 30;
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // limpar chunks anteriores antes de tentar novamente
    deleteExistingChunks(outputDir, ext);

    const chunkPaths = await splitMediaIntoChunks(inputPath, outputDir, segmentSeconds);
    if (chunkPaths.length === 0) return [];

    let maxChunkBytes = 0;
    for (const chunkPath of chunkPaths) {
      try {
        const size = fs.statSync(chunkPath).size;
        if (size > maxChunkBytes) maxChunkBytes = size;
      } catch {
        // ignorar
      }
    }

    if (maxChunkBytes > 0 && maxChunkBytes <= MAX_CHUNK_BYTES_TARGET) {
      return chunkPaths;
    }

    // Se já estamos no mínimo, não há como reduzir mais por duração
    if (segmentSeconds <= minSegmentSeconds) {
      return chunkPaths;
    }

    // reduzir pela metade e tentar de novo
    segmentSeconds = Math.max(minSegmentSeconds, Math.floor(segmentSeconds / 2));
  }

  // fallback: retorna o último resultado gerado
  return splitMediaIntoChunks(inputPath, outputDir, Math.max(30, Math.floor(CHUNK_DURATION_SECONDS / 4)));
}

/**
 * Transcreve um arquivo grande baixando/intermediando temporariamente e transcrevendo em fragmentos.
 * O arquivo é escrito em disco temporariamente, dividido com ffmpeg, cada fragmento é transcrito na Groq e os textos são concatenados.
 */
export async function groqTranscribeLargeFile(
  fileBuffer: Buffer,
  filename: string,
  options: GroqTranscribeOptions = {}
): Promise<{ text: string }> {
  const tmpDir = path.join(os.tmpdir(), `groq-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const inputPath = path.join(tmpDir, filename.replace(/[^a-zA-Z0-9._-]/g, '_'));

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(inputPath, fileBuffer);

    const chunkPaths = await splitMediaIntoChunksAdaptive(inputPath, tmpDir);
    if (chunkPaths.length === 0) {
      throw new Error('Não foi possível dividir o arquivo em fragmentos. Verifique o formato do vídeo/áudio.');
    }
    const texts: string[] = [];

    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      const chunkBuffer = fs.readFileSync(chunkPath);
      const chunkName = path.basename(chunkPath);
      if (chunkBuffer.length > MAX_DOWNLOAD_SIZE) {
        throw new Error(
          `Um fragmento ficou grande demais (${Math.round(chunkBuffer.length / 1024 / 1024)} MB). ` +
          'Tente usar um arquivo menor, ou envie um link do Google Drive/OneDrive para o servidor baixar e processar.'
        );
      }
      const result = await groqTranscribeFile(chunkBuffer, chunkName, options);
      if (result.text?.trim()) texts.push(result.text.trim());
    }

    const fullText = texts.join('\n\n').trim() || '(Sem fala detectada nos fragmentos.)';
    return { text: fullText };
  } finally {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.readdirSync(tmpDir).forEach((f) => fs.unlinkSync(path.join(tmpDir, f)));
        fs.rmdirSync(tmpDir);
      }
    } catch {
      // ignorar falha ao remover temp
    }
  }
}

export interface GroqTranscribeOptions {
  apiKey?: string;
  model?: 'whisper-large-v3' | 'whisper-large-v3-turbo';
  language?: string;
  response_format?: 'json' | 'text' | 'verbose_json';
  temperature?: number;
}

/**
 * Transcreve áudio/vídeo enviando o arquivo (Buffer) para a API Groq.
 */
export async function groqTranscribeFile(
  fileBuffer: Buffer,
  filename: string,
  options: GroqTranscribeOptions = {}
): Promise<{ text: string }> {
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('GROQ_API_KEY não definida.');
  }

  const safeFilename = ensureSupportedFilename(fileBuffer, filename);

  const model = options.model ?? 'whisper-large-v3-turbo';
  const formData = new FormData();
  formData.append('file', fileBuffer, safeFilename);
  formData.append('model', model);
  if (options.language) formData.append('language', options.language);
  if (options.response_format) formData.append('response_format', options.response_format);
  if (options.temperature !== undefined) formData.append('temperature', String(options.temperature));

  try {
    const response = await axios.post(GROQ_TRANSCRIPTIONS_URL, formData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
    });

    const data = response.data;
    const text = typeof data === 'string' ? data : (data?.text ?? '');
    return { text };
  } catch (error: any) {
    let errMessage = 'Erro ao transcrever arquivo.';
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      errMessage = `Groq STT error ${status}: ${typeof data === 'string' ? data : (data?.error?.message || JSON.stringify(data))}`;
    } else if (error.message) {
      errMessage = error.message;
    }
    throw new Error(errMessage);
  }
}

/**
 * Transcreve áudio/vídeo a partir de uma URL.
 * Para Google Drive, OneDrive e Dropbox: baixa o arquivo no servidor (seguindo redirects como 303)
 * e envia o conteúdo para a Groq, evitando o erro "failed to retrieve media: status code 303".
 * Para outras URLs: envia a URL para a Groq.
 */
export async function groqTranscribeFromUrl(
  url: string,
  options: GroqTranscribeOptions = {}
): Promise<{ text: string }> {
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('GROQ_API_KEY não definida.');
  }

  // Para cloud storage: baixamos o arquivo (com limite maior para permitir transcrição em fragmentos).
  if (isCloudStorageUrl(url)) {
    const normalizedUrl = await normalizeCloudStorageUrl(url);
    const { buffer, filename } = await downloadFileFromUrlLarge(normalizedUrl);
    if (buffer.length > MAX_DOWNLOAD_SIZE) {
      return groqTranscribeLargeFile(buffer, filename, options);
    }
    return groqTranscribeFile(buffer, filename, options);
  }

  // Para URLs diretas, enviar a URL para a Groq
  const normalizedUrl = await normalizeCloudStorageUrl(url);
  const model = options.model ?? 'whisper-large-v3-turbo';
  const formData = new FormData();
  formData.append('url', normalizedUrl);
  formData.append('model', model);
  if (options.language) formData.append('language', options.language);
  if (options.response_format) formData.append('response_format', options.response_format);
  if (options.temperature !== undefined) formData.append('temperature', String(options.temperature));

  try {
    const response = await axios.post(GROQ_TRANSCRIPTIONS_URL, formData, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
    });

    const data = response.data;
    const text = typeof data === 'string' ? data : (data?.text ?? '');
    return { text };
  } catch (error: any) {
    let errMessage = 'Erro ao transcrever URL.';
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      errMessage = `Groq STT error ${status}: ${typeof data === 'string' ? data : (data?.error?.message || JSON.stringify(data))}`;
    } else if (error.message) {
      errMessage = error.message;
    }
    throw new Error(errMessage);
  }
}
