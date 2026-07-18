'use client';

import { useCallback } from 'react';
import TaxonomyDualTables from '@/components/Dashboard/TaxonomyDualTables';

export default function CompetenciasPage() {
  const mapCatalogRow = useCallback((row: Record<string, unknown>) => ({
    id: Number(row.id),
    parent: String(row.competencia ?? ''),
    child: String(row.conteudo ?? ''),
    origin: (row.origin === 'gerado' ? 'gerado' : 'original') as 'original' | 'gerado',
  }), []);

  const mapPendingRow = useCallback((row: Record<string, unknown>) => ({
    id: Number(row.id),
    parent: String(row.competencia ?? ''),
    child: String(row.conteudo ?? ''),
    question_id: row.question_id != null ? Number(row.question_id) : null,
    created_at: row.created_at ? String(row.created_at) : undefined,
  }), []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <TaxonomyDualTables
        title="Competências e conteúdos"
        parentLabel="Competência"
        childLabel="Conteúdo"
        catalogEndpoint="/api/admin/competencies"
        pendingEndpoint="/api/admin/competencies/pending"
        jsonExample={`{\n  "competencias": [\n    {\n      "competencia": "Diagnosticar síndrome coronariana aguda",\n      "conteudos": ["Angina instável", "Infarto com supra de ST", "Troponina"]\n    }\n  ]\n}`}
        mapCatalogRow={mapCatalogRow}
        mapPendingRow={mapPendingRow}
        buildCatalogBody={(parent, child, origin, id) => ({
          id,
          competencia: parent,
          conteudo: child,
          origin,
        })}
        buildImportBody={(parsed) => {
          if (Array.isArray(parsed)) return { competencias: parsed };
          if (parsed && typeof parsed === 'object') return parsed as object;
          return { competencias: [] };
        }}
      />
    </div>
  );
}
