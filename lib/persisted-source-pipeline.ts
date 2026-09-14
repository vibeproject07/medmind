import type { SpacySourceSegment } from './spacy-tokenizer';
import {
  canonicalTranscriptionText,
  processExtractedSource,
  type SourceContentProcessing,
  type SourceContentStageCallback,
} from './source-content-pipeline';

export interface PersistedSourceProcessing {
  originalText: string;
  result: string;
  provenance: SourceContentProcessing & {
    sourceType: string;
    segments: SpacySourceSegment[];
    transformation_error?: string;
  };
}

export async function preparePersistedSource(
  {
    originalText,
    sourceType,
    segments = [],
    transform,
    onStage,
  }: {
    originalText: string;
    sourceType: string;
    segments?: SpacySourceSegment[];
    transform?: (text: string) => Promise<string>;
    onStage?: SourceContentStageCallback;
  },
  processSource: typeof processExtractedSource = processExtractedSource,
): Promise<PersistedSourceProcessing> {
  const processing = await processSource(
    { text: originalText, sourceType, segments },
    undefined,
    onStage,
  );
  let result = originalText;
  let transformationError: string | undefined;
  if (transform) {
    try {
      result = await transform(originalText);
    } catch (error) {
      transformationError =
        error instanceof Error ? error.message : 'Falha ao transformar o conteúdo.';
    }
  }
  return {
    originalText,
    result,
    provenance: {
      sourceType,
      segments,
      ...processing,
      ...(transformationError ? { transformation_error: transformationError } : {}),
    },
  };
}

export async function preparePersistedTranscription(
  {
    transcription,
    sourceType,
    transform,
    onStage,
  }: {
    transcription: {
      text: string;
      rawText?: string;
      segments: SpacySourceSegment[];
    };
    sourceType: 'audio' | 'video';
    transform?: (text: string) => Promise<string>;
    onStage?: SourceContentStageCallback;
  },
  processSource: typeof processExtractedSource = processExtractedSource,
): Promise<PersistedSourceProcessing> {
  return preparePersistedSource(
    {
      originalText: canonicalTranscriptionText(transcription),
      sourceType,
      segments: transcription.segments,
      transform,
      onStage,
    },
    processSource,
  );
}