export type ProcessingRunTextOutput = {
  originalText: string;
  pipelineText: string;
  wholeTranscription?: string;
  cleanedTranscription?: string;
  wholeExtractionText?: string;
  cleanedExtractionText?: string;
};

export function mapProcessingRunTexts(
  category: 'document' | 'text' | 'image' | 'audio' | 'video',
  output: ProcessingRunTextOutput,
): {
  extractionText: string;
  processedText: string;
  wholeTranscription: string | null;
  cleanedTranscription: string | null;
  wholeExtractionText: string | null;
  cleanedExtractionText: string | null;
} {
  const isMedia = category === 'audio' || category === 'video';
  const wholeTranscription = output.wholeTranscription ?? null;
  const cleanedTranscription = output.cleanedTranscription ?? null;
  const wholeExtractionText = output.wholeExtractionText ?? null;
  const cleanedExtractionText = output.cleanedExtractionText ?? null;

  return {
    extractionText: isMedia
      ? wholeTranscription ?? output.originalText
      : wholeExtractionText ?? output.originalText,
    processedText: isMedia
      ? cleanedTranscription ?? output.pipelineText
      : cleanedExtractionText ?? output.pipelineText,
    wholeTranscription,
    cleanedTranscription,
    wholeExtractionText,
    cleanedExtractionText,
  };
}