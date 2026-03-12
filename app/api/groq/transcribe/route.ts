import { NextRequest, NextResponse } from 'next/server';
import { groqTranscribeFile, groqTranscribeFromUrl, groqTranscribeLargeFile, MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION } from '@/lib/groq-stt';

export const runtime = 'nodejs';

const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (limite por requisição Groq)

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY não configurada no servidor. Defina em .env.local' },
        { status: 500 }
      );
    }

    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file || typeof file === 'string') {
        return NextResponse.json(
          { error: 'Envie um arquivo de áudio ou vídeo no campo "file".' },
          { status: 400 }
        );
      }
      if (file.size > MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION) {
        return NextResponse.json(
          { error: `Arquivo muito grande. Máximo ${Math.round(MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION / 1024 / 1024)} MB (transcrição em fragmentos).` },
          { status: 400 }
        );
      }
      const type = (file.type || '').toLowerCase();
      if (!type.startsWith('audio/') && !type.startsWith('video/')) {
        return NextResponse.json(
          { error: 'Formato não suportado. Use áudio ou vídeo (mp3, mp4, wav, webm, m4a, ogg, flac, etc.).' },
          { status: 400 }
        );
      }
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result = buffer.length > MAX_SINGLE_FILE_SIZE
        ? await groqTranscribeLargeFile(buffer, file.name || 'audio')
        : await groqTranscribeFile(buffer, file.name || 'audio');
      return NextResponse.json(result);
    }

    if (contentType.includes('application/json')) {
      const body = await request.json();
      const url = typeof body?.url === 'string' ? body.url.trim() : '';
      if (!url) {
        return NextResponse.json(
          { error: 'Envie um link no corpo: { "url": "https://..." }' },
          { status: 400 }
        );
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return NextResponse.json(
          { error: 'O link deve começar com http:// ou https://' },
          { status: 400 }
        );
      }
      // Suporta URLs diretas e links de serviços de cloud storage (Google Drive, OneDrive, etc.)
      const urlLower = url.toLowerCase();
      const isCloudStorage = 
        urlLower.includes('drive.google.com') || 
        urlLower.includes('onedrive.live.com') || 
        urlLower.includes('1drv.ms') ||
        urlLower.includes('dropbox.com');
      
      if (!isCloudStorage) {
        // Para URLs não-cloud, verificar se parece ser um link direto para arquivo de mídia
        const mediaExtensions = ['.mp3', '.mp4', '.wav', '.webm', '.m4a', '.ogg', '.flac', '.mpeg', '.mpga'];
        const hasMediaExtension = mediaExtensions.some(ext => urlLower.includes(ext));
        if (!hasMediaExtension && !urlLower.includes('blob:') && !urlLower.includes('data:')) {
          console.warn('URL pode não ser um link direto para arquivo de mídia:', url);
        }
      }
      
      try {
        const result = await groqTranscribeFromUrl(url);
        return NextResponse.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao transcrever URL.';
        // Mensagem mais específica para URLs
        if (message.includes('404') || message.includes('not found')) {
          let errorMsg = 'Arquivo não encontrado na URL fornecida.';
          if (isCloudStorage) {
            errorMsg += ' Para Google Drive ou OneDrive, certifique-se de que o arquivo está configurado como "Qualquer pessoa com o link pode visualizar" ou "Público".';
          } else {
            errorMsg += ' Verifique se o link é um link direto para o arquivo de áudio/vídeo e está acessível publicamente.';
          }
          return NextResponse.json({ error: errorMsg }, { status: 404 });
        }
        if (message.includes('403') || message.includes('forbidden')) {
          let errorMsg = 'Acesso negado à URL.';
          if (isCloudStorage) {
            errorMsg += ' Para Google Drive ou OneDrive, certifique-se de que o arquivo está configurado como "Qualquer pessoa com o link pode visualizar" ou "Público".';
          } else {
            errorMsg += ' O arquivo pode estar protegido ou requer autenticação. Use um link público direto para o arquivo.';
          }
          return NextResponse.json({ error: errorMsg }, { status: 403 });
        }
        return NextResponse.json(
          { error: `Erro ao transcrever: ${message}. ${isCloudStorage ? 'Para Google Drive ou OneDrive, certifique-se de que o arquivo está público e acessível.' : 'Certifique-se de que a URL é um link direto para um arquivo de áudio ou vídeo acessível publicamente.'}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Envie multipart/form-data com um arquivo ou application/json com { "url": "..." }' },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao transcrever.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
