'use client';

export interface NoteDeCSRecord {
  term: string;
  code: string;
  tree_ids?: string[];
  hierarchy_path?: string;
  role?: 'primary' | 'secondary';
  scope_note?: string;
  name_en?: string;
}

export default function NoteDeCsDescriptorsTable({
  descriptors,
  emptyMessage = 'Nenhum descritor gerado ainda. Use o botão acima para classificar esta nota.',
}: {
  descriptors: NoteDeCSRecord[];
  emptyMessage?: string;
}) {
  const primary = descriptors.filter((d) => d.role === 'primary' || !d.role);
  const secondary = descriptors.filter((d) => d.role === 'secondary');

  if (descriptors.length === 0) {
    return <p className="text-gray-400 italic text-sm">{emptyMessage}</p>;
  }

  const maxRows = Math.max(primary.length, secondary.length, 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left py-2 px-3 bg-indigo-50 border border-indigo-100 rounded-tl-lg text-xs font-semibold text-indigo-700 uppercase tracking-wide w-1/2">
              Primary
              <span className="block font-normal text-indigo-400 normal-case tracking-normal mt-0.5">
                Núcleo semântico
              </span>
            </th>
            <th className="text-left py-2 px-3 bg-slate-50 border border-slate-100 rounded-tr-lg text-xs font-semibold text-slate-500 uppercase tracking-wide w-1/2">
              Secondary
              <span className="block font-normal text-slate-400 normal-case tracking-normal mt-0.5">
                Contexto / detalhamento
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRows }).map((_, i) => {
            const dp = primary[i];
            const ds = secondary[i];
            return (
              <tr key={i} className="align-top">
                <td className="py-2 px-3 border border-indigo-100 bg-indigo-50/40">
                  {dp ? (
                    <div>
                      <span className="font-semibold text-indigo-800">{dp.term}</span>
                      {dp.code && (
                        <span className="block text-xs text-indigo-400 font-mono mt-0.5">{dp.code}</span>
                      )}
                      {dp.hierarchy_path && (
                        <span className="block text-xs text-indigo-300 mt-0.5">{dp.hierarchy_path}</span>
                      )}
                      {dp.scope_note && (
                        <span className="block text-xs text-gray-400 mt-1 line-clamp-2">{dp.scope_note}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="py-2 px-3 border border-slate-100 bg-slate-50/40">
                  {ds ? (
                    <div>
                      <span className="font-medium text-slate-700">{ds.term}</span>
                      {ds.code && (
                        <span className="block text-xs text-slate-400 font-mono mt-0.5">{ds.code}</span>
                      )}
                      {ds.hierarchy_path && (
                        <span className="block text-xs text-slate-300 mt-0.5">{ds.hierarchy_path}</span>
                      )}
                      {ds.scope_note && (
                        <span className="block text-xs text-gray-400 mt-1 line-clamp-2">{ds.scope_note}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
