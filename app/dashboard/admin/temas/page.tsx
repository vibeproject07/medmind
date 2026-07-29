'use client';

import { useCallback } from 'react';
import TaxonomyDualTables from '@/components/Dashboard/TaxonomyDualTables';

export default function TemasPage() {
  const mapCatalogRow = useCallback((row: Record<string, unknown>) => ({
    id: Number(row.id),
    parent: String(row.tema ?? ''),
    child: String(row.subtema ?? ''),
    origin: (row.origin === 'gerado' ? 'gerado' : 'original') as 'original' | 'gerado',
  }), []);

  const mapPendingRow = useCallback((row: Record<string, unknown>) => ({
    id: Number(row.id),
    parent: String(row.tema ?? ''),
    child: String(row.subtema ?? ''),
    question_id: row.question_id != null ? Number(row.question_id) : null,
    created_at: row.created_at ? String(row.created_at) : undefined,
  }), []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <TaxonomyDualTables
        title="Temas e Subtemas"
        parentLabel="Tema"
        childLabel="Subtema"
        catalogEndpoint="/api/admin/themes"
        pendingEndpoint="/api/admin/themes/pending"
        jsonExample={`{\n  "temas": [\n    {\n      "tema": "Cardiologia",\n      "subtemas": ["Insuficiência cardíaca", "Arritmias", "Síndromes coronarianas"]\n    }\n  ]\n}`}
        mapCatalogRow={mapCatalogRow}
        mapPendingRow={mapPendingRow}
        buildCatalogBody={(parent, child, origin, id) => ({
          id,
          tema: parent,
          subtema: child,
          origin,
        })}
        buildImportBody={(parsed) => {
          if (Array.isArray(parsed)) return { temas: parsed };
          if (parsed && typeof parsed === 'object') return parsed as object;
          return { temas: [] };
        }}
      />
    </div>
  );
}
