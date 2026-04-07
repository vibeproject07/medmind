'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Search, Loader2, BookOpen } from 'lucide-react';

interface DeCSRecord {
  term: string;
  code: string;
  tree_ids: string[];
  hierarchy_path: string;
  synonyms?: string[];
}

interface DeCSAutocompleteProps {
  selectedTerms: string[];
  onChange: (terms: string[]) => void;
  lang?: 'pt' | 'en' | 'es';
  placeholder?: string;
  label?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

export default function DeCSAutocomplete({
  selectedTerms,
  onChange,
  lang = 'pt',
  placeholder = 'Buscar termos DeCS/MeSH...',
  label,
}: DeCSAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [results, setResults] = useState<DeCSRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(inputValue.trim(), 400);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const token = getAuthToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`/api/decs/search?q=${encodeURIComponent(debouncedQuery)}&lang=${lang}`, { headers })
      .then((res) => res.json())
      .then((data: { records?: DeCSRecord[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setResults([]);
        } else {
          const filtered = (data.records ?? []).filter(
            (r) => !selectedTerms.includes(r.term)
          );
          setResults(filtered);
          setShowDropdown(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Erro ao buscar termos DeCS');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, lang, selectedTerms]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (record: DeCSRecord) => {
      if (!selectedTerms.includes(record.term)) {
        onChange([...selectedTerms, record.term]);
      }
      setInputValue('');
      setShowDropdown(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    },
    [selectedTerms, onChange]
  );

  const handleRemove = useCallback(
    (term: string) => {
      onChange(selectedTerms.filter((t) => t !== term));
    },
    [selectedTerms, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    } else if (e.key === 'Backspace' && inputValue === '' && selectedTerms.length > 0) {
      handleRemove(selectedTerms[selectedTerms.length - 1]);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-teal-600" />
          {label}
        </label>
      )}

      <div
        onClick={() => inputRef.current?.focus()}
        className="min-h-[42px] w-full px-3 py-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-transparent cursor-text flex flex-wrap gap-2 items-center"
      >
        {selectedTerms.map((term) => (
          <span
            key={term}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-teal-100 text-teal-700"
          >
            {term}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(term);
              }}
              className="hover:bg-teal-200 rounded-full p-0.5 transition"
              aria-label={`Remover ${term}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        <div className="flex items-center gap-1 flex-1 min-w-[160px]">
          {loading ? (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin flex-shrink-0" />
          ) : (
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedTerms.length === 0 ? placeholder : ''}
            className="flex-1 outline-none bg-transparent text-sm"
          />
        </div>
      </div>

      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}

      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto overscroll-contain">
          {results.map((record) => (
            <button
              key={`${record.code}-${record.term}`}
              type="button"
              onClick={() => handleSelect(record)}
              className="w-full px-4 py-2.5 text-left hover:bg-teal-50 transition border-b border-gray-100 last:border-0"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-gray-800">{record.term}</span>
                {record.tree_ids.length > 0 && (
                  <span className="text-xs text-gray-400 font-mono flex-shrink-0 mt-0.5">
                    {record.tree_ids[0]}
                  </span>
                )}
              </div>
              {record.hierarchy_path && (
                <p className="text-xs text-teal-600 mt-0.5">{record.hierarchy_path}</p>
              )}
              {record.synonyms && record.synonyms.length > 0 && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {record.synonyms.slice(0, 3).join(', ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {showDropdown && !loading && debouncedQuery.length >= 2 && results.length === 0 && !error && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg px-4 py-3 text-sm text-gray-500 text-center">
          Nenhum termo encontrado para &ldquo;{debouncedQuery}&rdquo;
        </div>
      )}
    </div>
  );
}
