'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, CheckCircle, XCircle, AlertCircle, ImageIcon, Loader2, X } from 'lucide-react';

interface UploadResult {
  file: string;
  xref?: number;
  questionId?: number;
  status: 'linked' | 'not_found' | 'no_xref' | 'error';
  reason?: string;
}

interface UploadSummary {
  total: number;
  linked: number;
  not_found: number;
  skipped: number;
}

export default function AdminImagesPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const pngs = Array.from(incoming).filter(
      (f) => f.type === 'image/png' || f.name.toLowerCase().endsWith('.png')
    );
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...pngs.filter((f) => !names.has(f.name))];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const removeFile = (name: string) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setResults(null);
    setSummary(null);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');

      const formData = new FormData();
      for (const file of files) formData.append('files', file);

      const res = await fetch('/api/admin/upload-images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro no servidor');

      setResults(data.results);
      setSummary(data.summary);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload de Imagens em Lote</h1>
        <p className="mt-1 text-sm text-gray-500">
          Faça upload de PNGs nomeados no padrão <code className="bg-gray-100 px-1 rounded">p001_img001_xref5.png</code>.
          O sistema extrai o <strong>xref</strong> do nome, localiza a questão correspondente e vincula a imagem.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,image/png"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-700">Arraste os PNGs aqui ou clique para selecionar</p>
        <p className="text-xs text-gray-400 mt-1">Apenas arquivos PNG</p>
      </div>

      {files.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              <ImageIcon className="inline w-4 h-4 mr-1 text-gray-400" />
              {files.length} arquivo{files.length !== 1 ? 's' : ''} selecionado{files.length !== 1 ? 's' : ''}
            </span>
            <button onClick={() => setFiles([])} className="text-xs text-red-500 hover:text-red-700 transition">
              Limpar tudo
            </button>
          </div>
          <ul className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
            {files.map((f) => (
              <li key={f.name} className="flex items-center justify-between px-4 py-2 text-sm text-gray-700">
                <span className="truncate max-w-xs font-mono text-xs">{f.name}</span>
                <button onClick={(e) => { e.stopPropagation(); removeFile(f.name); }} className="ml-2 text-gray-400 hover:text-red-500 transition">
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-300 text-white font-medium py-2 px-4 rounded-lg transition"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {loading ? 'Processando…' : 'Processar e Vincular'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {summary && results && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-700">{summary.linked}</p>
              <p className="text-xs text-green-600 mt-1">Vinculadas</p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-yellow-700">{summary.not_found}</p>
              <p className="text-xs text-yellow-600 mt-1">Não encontradas</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-gray-700">{summary.skipped}</p>
              <p className="text-xs text-gray-600 mt-1">Ignoradas</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-700">Resultado por arquivo</span>
            </div>
            <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {results.map((r) => (
                <li key={r.file} className="flex items-start gap-3 px-4 py-3">
                  {r.status === 'linked' ? (
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : r.status === 'not_found' ? (
                    <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-gray-700 truncate">{r.file}</p>
                    {r.status === 'linked' ? (
                      <p className="text-xs text-green-600 mt-0.5">
                        Vinculada à questão #{r.questionId} (xref={r.xref})
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-0.5">{r.reason}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
