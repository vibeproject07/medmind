import mammoth from 'mammoth';
import JSZip from 'jszip';

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim();
  if (!text) throw new Error('O documento Word não contém texto legível.');
  return text;
}

export async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    throw new Error('Nenhum slide encontrado no arquivo PowerPoint.');
  }

  const slides: string[] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async('text');
    const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    const parts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].trim();
      if (t) parts.push(t);
    }
    const slideText = parts.join(' ');
    const slideNum = slideFile.match(/slide(\d+)/)?.[1] ?? '';
    if (slideText) {
      slides.push(`--- Slide ${slideNum} ---\n${slideText}`);
    }
  }

  if (slides.length === 0) {
    throw new Error('Não foi possível extrair texto dos slides. O arquivo pode conter apenas imagens.');
  }

  return slides.join('\n\n');
}
