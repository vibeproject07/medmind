import {
  processExtractedSource,
  type SourceContentProcessing,
} from './source-content-pipeline';

export interface YouTubeSourceResult extends SourceContentProcessing {
  text: string;
  rawText: string;
}

export async function processYouTubeSource(
  url: string,
  dependencies?: {
    extract: (input: { url: string; agentKey: string }) => Promise<string>;
    process: typeof processExtractedSource;
  },
): Promise<YouTubeSourceResult> {
  const resolved = dependencies ?? {
    extract: (await import('./gemini')).geminiProcessYouTube,
    process: processExtractedSource,
  };
  const rawText = await resolved.extract({ url, agentKey: 'youtube_transcript' });
  const processing = await resolved.process({ text: rawText, sourceType: 'video' });
  return { text: rawText, rawText, ...processing };
}