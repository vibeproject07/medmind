'use client';

import { useState, useEffect } from 'react';
import { X, Mic, Upload, Link as LinkIcon } from 'lucide-react';
import {
  describeTranscriptionProgress,
  transcribeWithProgress,
} from '@/lib/groq-transcription-client';


export interface ResumoAulasModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Arquivos pré-selecionados (ex.: ao clicar em um botão de tipo na aba Fontes) */
  initialFiles?: File[];
  /** Link pré-preenchido (ex.: ao vir do modal Criar Nota) */
  initialLink?: string;
  /** Restringe o tipo de arquivo no upload (ex.: ".pdf,application/pdf") */
  accept?: string;
  /** Exibe botão "Continuar para nova nota" para apenas selecionar arquivo/link e redirecionar */
  showContinueToNote?: boolean;
  /** Chamado ao clicar em "Continuar para nova nota" com (files, link) */
  onContinueToNote?: (files: File[], link: string) => void;
  /** Chamado com (melhorado, original, nomes dos arquivos) quando o usuário adiciona o resumo à nota */
  onSaveResumo?: (melhorado: string, original: string, fileNames?: string[]) => void;
}

const ACCEPTED_FILE_TYPES =
  'video/*,audio/*,image/*,.pdf,.doc,.docx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';

export default function ResumoAulasModal({ isOpen, onClose, title = 'Transformando Arquivos com IA', initialFiles, initialLink, accept: acceptProp, showContinueToNote, onContinueToNote, onSaveResumo }: ResumoAulasModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeMessage, setSizeMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const fileAccept = acceptProp ?? ACCEPTED_FILE_TYPES;

  useEffect(() => {
    if (isOpen && initialFiles?.length) {
      setFiles(initialFiles);
    }
  }, [isOpen, initialFiles?.length]);

  useEffect(() => {
    if (isOpen && initialLink !== undefined) {
      setLink(initialLink);
    }
  }, [isOpen, initialLink]);

  const handleClose = () => {
    setFiles([]);
    setLink('');
    setResult(null);
    setError(null);
    setSizeMessage(null);
    setSummary(null);
    setSummaryError(null);
    setShowMoreInfo(false);
    setProgressMessage(null);
    onClose();
  };

  const resetResults = () => {
    setResult(null);
    setError(null);
    setSizeMessage(null);
    setSummary(null);
    setSummaryError(null);
    setProgressMessage(null);
  };

  const handleTranscribeAndSummarize = async () => {
    setError(null);
    setResult(null);
    setSizeMessage(null);
    setSummary(null);
    setSummaryError(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setError('Faça login para usar transcrição e resumo.');
        return;
      }
      let transcriptionText = '';
      const audioOrVideoFile = files.find((f) => f.type.startsWith('audio/') || f.type.startsWith('video/'));
      if (audioOrVideoFile) {
        const formData = new FormData();
        formData.append('file', audioOrVideoFile);
        const data = await transcribeWithProgress(formData, token, (progress) => {
          setProgressMessage(describeTranscriptionProgress(progress));
        });
        const orig = data.originalSize ?? 0;
        const extr = data.extractedSize ?? 0;
        if (orig > 0 && extr < orig) {
          const origMB = (orig / 1024 / 1024).toFixed(2);
          const extrMB = (extr / 1024 / 1024).toFixed(2);
          const diffMB = ((orig - extr) / 1024 / 1024).toFixed(2);
          setSizeMessage(`Tamanho do arquivo reduzido: de ${origMB} MB para ${extrMB} MB (economia de ${diffMB} MB).`);
        }
        transcriptionText = data.text || '';
        setResult(transcriptionText);

        if (transcriptionText.trim()) {
          const geminiRes = await fetch('/api/gemini/transform', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              transcription: transcriptionText,
              instruction: 'Resuma a transcrição em material de estudo claro, organizado e em português do Brasil.',
              agentKey: 'ajuste_transcricao',
            }),
          });
          const geminiText = await geminiRes.text();
          let geminiData: { error?: string; text?: string };
          try {
            geminiData = geminiText ? JSON.parse(geminiText) : {};
          } catch {
            setSummaryError('Resposta inválida do servidor ao gerar resumo.');
            return;
          }
          if (geminiRes.ok && geminiData.text) {
            setSummary(geminiData.text);
          } else {
            setSummaryError(geminiData.error || 'Não foi possível gerar o resumo.');
          }
        }
      } else if (link.trim()) {
        const linkUrl = link.trim();
        const isYouTube =
          linkUrl.includes('youtube.com/watch') ||
          linkUrl.includes('youtu.be/');

        if (isYouTube) {
          const resYt = await fetch('/api/gemini/process-youtube', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ url: linkUrl }),
          });
          const textYt = await resYt.text();
          let dataYt: { error?: string; text?: string };
          try {
            dataYt = textYt ? JSON.parse(textYt) : {};
          } catch {
            setError('Resposta inválida do servidor ao transcrever o vídeo do YouTube.');
            return;
          }
          if (!resYt.ok) {
            setError(dataYt.error || 'Erro ao transcrever o vídeo do YouTube.');
            return;
          }
          transcriptionText = dataYt.text || '';
          setResult(transcriptionText);
        } else {
          const data = await transcribeWithProgress({ url: linkUrl }, token, (progress) => {
            setProgressMessage(describeTranscriptionProgress(progress));
          });
          const orig = data.originalSize ?? 0;
          const extr = data.extractedSize ?? 0;
          if (orig > 0 && extr < orig) {
            const origMB = (orig / 1024 / 1024).toFixed(2);
            const extrMB = (extr / 1024 / 1024).toFixed(2);
            const diffMB = ((orig - extr) / 1024 / 1024).toFixed(2);
            setSizeMessage(`Tamanho do arquivo reduzido: de ${origMB} MB para ${extrMB} MB (economia de ${diffMB} MB).`);
          }
          transcriptionText = data.text || '';
          setResult(transcriptionText);
        }
      } else {
        // Nenhum áudio/vídeo nem link: mostrar apenas o conteúdo original de documento ou imagem, sem Gemini
        const docOrImageFile = files.find(
          (f) =>
            f.type.startsWith('image/') ||
            f.type === 'application/pdf' ||
            f.type === 'application/msword' ||
            f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            f.type === 'application/vnd.ms-powerpoint' ||
            f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        );
        if (docOrImageFile) {
          const formDataDoc = new FormData();
          formDataDoc.append('file', docOrImageFile);
          const resDoc = await fetch('/api/gemini/process-document', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formDataDoc,
          });
          const textDoc = await resDoc.text();
          const NAO_PROCESSADO_PELA_IA = 'Conteúdo não processado pela IA';
          let dataDoc: { error?: string | { message?: string; code?: number; status?: string }; text?: string; originalText?: string };
          try {
            dataDoc = textDoc ? JSON.parse(textDoc) : {};
          } catch {
            setError('Resposta inválida do servidor ao processar o documento.');
            return;
          }
          if (resDoc.ok) {
            setResult(dataDoc.originalText || '');
            setSummary(NAO_PROCESSADO_PELA_IA);
          } else {
            const errMsg = dataDoc.error;
            const message =
              typeof errMsg === 'string'
                ? errMsg
                : errMsg && typeof errMsg === 'object' && typeof (errMsg as { message?: string }).message === 'string'
                  ? (errMsg as { message: string }).message
                  : resDoc.status === 404
                    ? 'Rota da API não encontrada. Reinicie o servidor de desenvolvimento (npm run dev).'
                    : 'Não foi possível processar o documento.';
            setError(message || 'Não foi possível processar o documento.');
          }
        } else {
          setError('Adicione um arquivo de áudio, vídeo, documento (PDF, Word, PowerPoint) ou imagem, ou informe um link.');
        }
      }
      if (transcriptionText.trim()) {
        const geminiRes = await fetch('/api/gemini/transform', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            transcription: transcriptionText,
            instruction: 'Analise e organize a transcrição acima em material de estudo.',
            agentKey: 'ajuste_transcricao',
          }),
        });
        const geminiText = await geminiRes.text();
        let geminiData: { error?: string; text?: string };
        try {
          geminiData = geminiText ? JSON.parse(geminiText) : {};
        } catch {
          setSummaryError('Resposta inválida do servidor ao gerar resumo.');
          return;
        }
        if (geminiRes.ok && geminiData.text) {
          setSummary(geminiData.text);
        } else {
          setSummaryError(geminiData.error || 'Não foi possível gerar o resumo.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao transcrever e resumir.');
    } finally {
      setLoading(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    resetResults();
  };

  if (!isOpen) return null;

  const hasLink = link.trim().length > 0;
  const canTranscribe = files.length > 0 || hasLink;
  const showOnlyAddButton = showContinueToNote && (result || summary) && onSaveResumo;
  const originalContent = result ?? '';
  const transformedContent = summary ?? '';
  const isAudioOrVideoSelection = files.some((f) => f.type.startsWith('audio/') || f.type.startsWith('video/')) || (hasLink && !link.trim().includes('youtube.com/watch') && !link.trim().includes('youtu.be/'));
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">{title}</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {showOnlyAddButton ? (
            <>
              <p className="text-sm text-green-700 font-medium text-center">
                Processamento concluído. Adicione o conteúdo à sua nota.
              </p>
              <div className="pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    const melhorado = summary ?? result ?? '';
                    const original = result ?? '';
                    const fileNames = files.length > 0 ? files.map((f) => f.name) : link.trim() ? [link.trim()] : [];
                    onSaveResumo!(melhorado, original, fileNames);
                    handleClose();
                  }}
                  className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium"
                >
                  Adicionar à nota
                </button>
              </div>
            </>
          ) : (
          <>
          <p className="text-sm text-gray-600">
            Selecione a estrela em um dos campos abaixo para tornar o texto exibido como conteúdo de sua nota. Só irá aparecer como um dos textos como conteúdo da nota após a seleção de um deles.
          </p>
          {/* Versão obsoleta desta página:
          <p className="text-sm text-gray-600">
            Envie vídeos, imagens, áudios ou documentos, ou cole o link onde o material está disponível (incluindo links do YouTube). A transcrição é feita para áudio, vídeo e vídeos do YouTube.
          </p>
          */}
          {!showMoreInfo ? (
            <button
              type="button"
              onClick={() => setShowMoreInfo(true)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium hover:underline"
            >
              Saiba mais
            </button>
          ) : (
            <>
              <p className="text-xs text-primary-600 bg-primary-50 p-2 rounded">
                💡 <strong>Dica:</strong> Suporta links do Google Drive e OneDrive! Certifique-se de que o arquivo está configurado como &quot;Qualquer pessoa com o link pode visualizar&quot; ou &quot;Público&quot;.
              </p>
              <p className="text-xs text-gray-500">
                Vídeos são convertidos em áudio antes da transcrição. Arquivos grandes são
                divididos em partes (até 500 MB), e as minutagens de cada parte são ajustadas
                antes da consolidação.
              </p>
              <button
                type="button"
                onClick={() => setShowMoreInfo(false)}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium hover:underline"
              >
                Mostrar menos
              </button>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Upload className="w-4 h-4 inline mr-1" />
              Upload de arquivo
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-400 transition-colors">
              <input
                type="file"
                accept={fileAccept}
                multiple
                onChange={(e) => {
                  const selected = e.target.files;
                  if (selected?.length) {
                    setFiles((prev) => [...prev, ...Array.from(selected)]);
                    resetResults();
                  }
                  e.target.value = '';
                }}
                className="w-full text-sm text-gray-600 file:mr-2 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 file:font-medium"
              />
              <p className="mt-2 text-xs text-gray-500">
                Vídeo, áudio, imagem, PDF, Word (.doc, .docx) e PowerPoint (.ppt, .pptx)
              </p>
              {files.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between gap-2 py-2 px-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <span className="text-sm text-gray-700 truncate flex-1" title={file.name}>
                        {file.name} ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="flex-shrink-0 p-1 rounded hover:bg-red-100 text-gray-500 hover:text-red-600 transition"
                        aria-label="Remover arquivo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {files.some((f) => f.size > 100 * 1024 * 1024) && (
                <p className="mt-2 text-xs text-amber-600">
                  Arquivo grande. Em alguns servidores o upload pode falhar — para arquivos acima de ~100 MB, use o link do Google Drive/OneDrive.
                </p>
              )}
              {files.some((f) => f.size > 25 * 1024 * 1024) && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Este arquivo é grande e poderá ser dividido em várias partes. A quantidade
                  exata e o tempo estimado aparecerão durante a transcrição.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <LinkIcon className="w-4 h-4 inline mr-1" />
              Ou cole o link do material
            </label>
            <input
              type="url"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                resetResults();
              }}
              placeholder="https://..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {showContinueToNote ? (
            <div className="space-y-3">
              {loading && (
                <p className="text-sm text-primary-600 font-medium text-center">
                  Processando com IA (Gemini): transcrição, resumo ou descrição de imagens e slides. Aguarde.
                </p>
              )}
              <button
                type="button"
                disabled={!(files.length > 0 || link.trim()) || loading}
                onClick={handleTranscribeAndSummarize}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {loading ? 'Processando...' : 'Continuar para nova nota'}
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                disabled={!canTranscribe || loading}
                onClick={handleTranscribeAndSummarize}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                <Mic className="w-5 h-5" />
                {loading ? 'Transcrevendo e/ou resumindo...' : 'Transcrever e/ou resumir'}
              </button>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}
          {loading && progressMessage && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              {progressMessage}
            </div>
          )}
          {sizeMessage && (
            <div className="p-4 rounded-lg bg-primary-50 border border-primary-200 text-primary-800 text-sm">
              {sizeMessage}
            </div>
          )}
          {summaryError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {summaryError}
            </div>
          )}
          {(result || summary) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="px-4 py-3 rounded-lg border border-primary-200 bg-primary-50">
                <div className="font-semibold text-primary-700">Arquivo original</div>
                <div className="text-sm text-gray-600 whitespace-pre-wrap">{originalContent || '—'}</div>
              </div>
              <div className="px-4 py-3 rounded-lg border border-gray-200 bg-white">
                <div className="font-semibold text-gray-700">Arquivo transformado pela IA</div>
                <div className="text-sm text-gray-600 whitespace-pre-wrap">
                  {isAudioOrVideoSelection ? transformedContent || '—' : 'Conteúdo não processado pela IA'}
                </div>
              </div>
            </div>
          )}
          {!showOnlyAddButton && (result || summary) && onSaveResumo && (
            <div className="pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => {
                  const original = result ?? '';
                  const melhorado = summary ?? result ?? '';
                  const fileNames = files.length > 0 ? files.map((f) => f.name) : link.trim() ? [link.trim()] : [];
                  onSaveResumo(melhorado, original, fileNames);
                  handleClose();
                }}
                className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium"
              >
                Adicionar à nota
              </button>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
