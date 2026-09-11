import {
  processExtractedSource,
  type SourceContentProcessing,
} from './source-content-pipeline';
import { transcribeMediaPath } from './groq-stt';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import ytdl from '@distube/ytdl-core';

export interface YouTubeSourceResult extends SourceContentProcessing {
  text: string;
  rawText: string;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function normalizeYouTubeUrl(input: string): string {
  const candidate = input.trim().startsWith('http')
    ? input.trim()
    : `https://${input.trim()}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('URL do YouTube inválida.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('A URL do YouTube deve usar HTTPS.');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  let videoId = '';
  if (hostname === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  } else if (YOUTUBE_HOSTS.has(hostname)) {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v') ?? '';
    } else {
      const match = parsed.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/);
      videoId = match?.[1] ?? '';
    }
  }
  if (!YOUTUBE_VIDEO_ID.test(videoId)) {
    throw new Error('URL inválida. Informe um vídeo válido do YouTube.');
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export async function processYouTubeSource(
  url: string,
  dependencies?: {
    transcribe: (url: string) => Promise<string>;
    process: typeof processExtractedSource;
  },
): Promise<YouTubeSourceResult> {
  const resolved = dependencies ?? {
    transcribe: transcribeYouTubeWithGroq,
    process: processExtractedSource,
  };
  const rawText = await resolved.transcribe(url);
  const processing = await resolved.process({ text: rawText, sourceType: 'video' });
  return { text: rawText, rawText, ...processing };
}

const MAX_YOUTUBE_DURATION_SECONDS = 4 * 60 * 60;
const MAX_YOUTUBE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

async function transcribeYouTubeWithGroq(url: string): Promise<string> {
  const info = await ytdl.getInfo(url);
  const duration = Number(info.videoDetails.lengthSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Não foi possível determinar a duração do vídeo do YouTube.');
  }
  if (duration > MAX_YOUTUBE_DURATION_SECONDS) {
    throw new Error('O vídeo do YouTube excede o limite de 4 horas.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-groq-'));
  const mediaPath = path.join(tempDir, 'youtube-source.webm');
  try {
    const source = ytdl.downloadFromInfo(info, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });
    let downloadedBytes = 0;
    source.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_YOUTUBE_DOWNLOAD_BYTES) {
        source.destroy(new Error('O download do YouTube excedeu o limite de 1 GB.'));
      }
    });
    await pipeline(source, fs.createWriteStream(mediaPath, { flags: 'wx' }));

    const transcription = await transcribeMediaPath(
      mediaPath,
      'youtube-source.webm',
      'video/webm',
    );
    const rawText = String(transcription.rawText || transcription.text || '').trim();
    if (!rawText) throw new Error('A Groq Whisper não retornou uma transcrição.');
    return rawText;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}