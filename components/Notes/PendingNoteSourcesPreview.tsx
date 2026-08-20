'use client';

import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Music, Video, X } from 'lucide-react';

type LocalSource = {
  file: File;
  url: string;
};

function sourceIcon(file: File) {
  if (file.type.startsWith('image/')) return <ImageIcon className="h-4 w-4" />;
  if (file.type.startsWith('audio/')) return <Music className="h-4 w-4" />;
  if (file.type.startsWith('video/')) return <Video className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function canEmbed(file: File) {
  return file.type.startsWith('image/')
    || file.type.startsWith('audio/')
    || file.type.startsWith('video/')
    || file.type === 'application/pdf'
    || file.type.startsWith('text/');
}

export default function PendingNoteSourcesPreview({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) {
  const [sources, setSources] = useState<LocalSource[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setSources(next);
    setSelectedIndex((current) => Math.min(current, Math.max(0, next.length - 1)));
    return () => next.forEach((source) => URL.revokeObjectURL(source.url));
  }, [files]);

  const selected = sources[selectedIndex];
  if (!selected) return null;

  const { file, url } = selected;
  return (
    <section className="overflow-hidden rounded-xl border border-primary-100 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-primary-100 bg-primary-50/50 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Arquivo importado</p>
          <p className="max-w-[16rem] truncate text-sm font-medium text-gray-700" title={file.name}>{file.name}</p>
        </div>
        <a
          href={url}
          download={file.name}
          className="shrink-0 rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
        >
          Baixar original
        </a>
      </div>

      <div className="bg-gray-50 p-3">
        {file.type.startsWith('image/') && (
          <img src={url} alt={file.name} className="mx-auto max-h-80 max-w-full rounded-lg object-contain" />
        )}
        {file.type.startsWith('audio/') && <audio controls src={url} className="w-full" />}
        {file.type.startsWith('video/') && <video controls src={url} className="mx-auto max-h-80 w-full rounded-lg bg-black" />}
        {(file.type === 'application/pdf' || file.type.startsWith('text/')) && (
          <iframe src={url} title={file.name} className="h-80 w-full rounded-lg border border-gray-200 bg-white" />
        )}
        {!canEmbed(file) && (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-gray-500">
            <FileText className="h-8 w-8 text-gray-400" />
            <p>Este tipo de arquivo será mantido como fonte original e poderá ser aberto ou baixado após salvar.</p>
          </div>
        )}
      </div>

      <ul className="divide-y divide-gray-100">
        {sources.map((source, index) => (
          <li key={`${source.file.name}-${source.file.lastModified}-${index}`} className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => setSelectedIndex(index)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                index === selectedIndex ? 'bg-primary-50 text-primary-800' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="shrink-0">{sourceIcon(source.file)}</span>
              <span className="truncate">{source.file.name}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Remover ${source.file.name}`}
              title="Remover arquivo"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}