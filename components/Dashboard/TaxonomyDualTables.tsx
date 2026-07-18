'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

type Origin = 'original' | 'gerado';

interface CatalogRow {
  id: number;
  parent: string;
  child: string;
  origin: Origin;
}

interface PendingRow {
  id: number;
  parent: string;
  child: string;
  question_id?: number | null;
  created_at?: string;
}

interface TaxonomyDualTablesProps {
  title: string;
  parentLabel: string;
  childLabel: string;
  catalogEndpoint: string;
  pendingEndpoint: string;
  /** JSON import example shown in textarea placeholder */
  jsonExample: string;
  mapCatalogRow: (row: Record<string, unknown>) => CatalogRow;
  mapPendingRow: (row: Record<string, unknown>) => PendingRow;
  buildCatalogBody: (parent: string, child: string, origin: Origin, id?: number) => object;
  buildImportBody: (parsed: unknown) => object;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function TaxonomyDualTables({
  title,
  parentLabel,
  childLabel,
  catalogEndpoint,
  pendingEndpoint,
  jsonExample,
  mapCatalogRow,
  mapPendingRow,
  buildCatalogBody,
  buildImportBody,
}: TaxonomyDualTablesProps) {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formParent, setFormParent] = useState('');
  const [formChild, setFormChild] = useState('');
  const [formOrigin, setFormOrigin] = useState<Origin>('original');
  const [editId, setEditId] = useState<number | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, pRes] = await Promise.all([
        fetch(catalogEndpoint, { headers: authHeaders() }),
        fetch(`${pendingEndpoint}?status=pending`, { headers: authHeaders() }),
      ]);
      const cData = await cRes.json();
      const pData = await pRes.json();
      if (!cRes.ok) throw new Error(cData.error || 'Erro ao carregar catálogo');
      if (!pRes.ok) throw new Error(pData.error || 'Erro ao carregar pendentes');
      setCatalog((cData.items ?? []).map(mapCatalogRow));
      setPending((pData.items ?? []).map(mapPendingRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [catalogEndpoint, pendingEndpoint, mapCatalogRow, mapPendingRow]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEditId(null);
    setFormParent('');
    setFormChild('');
    setFormOrigin('original');
  };

  const handleSaveCatalog = async () => {
    if (!formParent.trim() || !formChild.trim()) return;
    setSaving(true);
    setError('');
    try {
      const body = buildCatalogBody(
        formParent.trim(),
        formChild.trim(),
        formOrigin,
        editId ?? undefined,
      );
      const res = await fetch(catalogEndpoint, {
        method: editId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: CatalogRow) => {
    setEditId(row.id);
    setFormParent(row.parent);
    setFormChild(row.child);
    setFormOrigin(row.origin);
  };

  const handleDeleteCatalog = async (id: number) => {
    if (!confirm('Excluir este registro do catálogo?')) return;
    setActionId(id);
    try {
      const res = await fetch(`${catalogEndpoint}?id=${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir');
    } finally {
      setActionId(null);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError('');
    try {
      const parsed = JSON.parse(jsonText);
      const res = await fetch(catalogEndpoint, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(buildImportBody(parsed)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro no import');
      setJsonText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON inválido');
    } finally {
      setImporting(false);
    }
  };

  const handleApprove = async (id: number) => {
    setActionId(id);
    try {
      const res = await fetch(pendingEndpoint, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id, action: 'approve' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao aprovar');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (id: number) => {
    setActionId(id);
    try {
      const res = await fetch(pendingEndpoint, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id, action: 'reject' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao rejeitar');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao rejeitar');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Catálogo original (importação JSON + CRUD) e fila de validação da IA.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Import JSON */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-2 flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Importar JSON (originais)
        </h2>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={6}
          placeholder={jsonExample}
          className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || !jsonText.trim()}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar para catálogo
        </button>
      </section>

      {/* Catalog CRUD */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Tabela original — {parentLabel} e {childLabel}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <input
            value={formParent}
            onChange={(e) => setFormParent(e.target.value)}
            placeholder={parentLabel}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={formChild}
            onChange={(e) => setFormChild(e.target.value)}
            placeholder={childLabel}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={formOrigin}
            onChange={(e) => setFormOrigin(e.target.value as Origin)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="original">original</option>
            <option value="gerado">gerado</option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveCatalog}
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editId ? 'Atualizar' : 'Adicionar'}
            </button>
            {editId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-3 py-2 border border-gray-200 font-semibold text-gray-600">ID</th>
                  <th className="px-3 py-2 border border-gray-200 font-semibold text-gray-600">{parentLabel}</th>
                  <th className="px-3 py-2 border border-gray-200 font-semibold text-gray-600">{childLabel}</th>
                  <th className="px-3 py-2 border border-gray-200 font-semibold text-gray-600">Origem</th>
                  <th className="px-3 py-2 border border-gray-200 font-semibold text-gray-600 w-28">Ações</th>
                </tr>
              </thead>
              <tbody>
                {catalog.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-400 italic border border-gray-200">
                      Nenhum registro no catálogo. Importe um JSON ou adicione manualmente.
                    </td>
                  </tr>
                ) : (
                  catalog.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/80">
                      <td className="px-3 py-2 border border-gray-200 text-gray-500 font-mono text-xs">{row.id}</td>
                      <td className="px-3 py-2 border border-gray-200">{row.parent}</td>
                      <td className="px-3 py-2 border border-gray-200">{row.child}</td>
                      <td className="px-3 py-2 border border-gray-200">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.origin === 'original'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {row.origin}
                        </span>
                      </td>
                      <td className="px-3 py-2 border border-gray-200">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleEdit(row)}
                            className="p-1.5 text-gray-500 hover:text-primary-600"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCatalog(row.id)}
                            disabled={actionId === row.id}
                            className="p-1.5 text-gray-500 hover:text-red-600"
                            title="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending validation */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">
          Tabela IA — validação manual
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Termos gerados pelos agentes. Ao aprovar, entram no catálogo com origem <strong>gerado</strong>.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-amber-50 text-left">
                <th className="px-3 py-2 border border-amber-100 font-semibold text-amber-800">ID</th>
                <th className="px-3 py-2 border border-amber-100 font-semibold text-amber-800">{parentLabel}</th>
                <th className="px-3 py-2 border border-amber-100 font-semibold text-amber-800">{childLabel}</th>
                <th className="px-3 py-2 border border-amber-100 font-semibold text-amber-800">Questão</th>
                <th className="px-3 py-2 border border-amber-100 font-semibold text-amber-800 w-40">Validação</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-400 italic border border-gray-200">
                    Nenhum termo pendente de validação.
                  </td>
                </tr>
              ) : (
                pending.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 border border-gray-200 text-gray-500 font-mono text-xs">{row.id}</td>
                    <td className="px-3 py-2 border border-gray-200">{row.parent}</td>
                    <td className="px-3 py-2 border border-gray-200">{row.child}</td>
                    <td className="px-3 py-2 border border-gray-200 text-xs text-gray-500">
                      {row.question_id ? `#${row.question_id}` : '—'}
                    </td>
                    <td className="px-3 py-2 border border-gray-200">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleApprove(row.id)}
                          disabled={actionId === row.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {actionId === row.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Aprovado
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(row.id)}
                          disabled={actionId === row.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                        >
                          Rejeitar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
