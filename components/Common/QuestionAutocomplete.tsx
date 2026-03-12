'use client';

import { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Search } from 'lucide-react';

interface Question {
  id: number;
  statement: string;
  tags?: string[];
}

interface QuestionAutocompleteProps {
  selectedQuestions: Question[];
  onChange: (questions: Question[]) => void;
  placeholder?: string;
  label?: string;
}

export default function QuestionAutocomplete({
  selectedQuestions,
  onChange,
  placeholder = 'Digite para buscar questões...',
  label,
}: QuestionAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredQuestions, setFilteredQuestions] = useState<Question[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Buscar questões da API
  useEffect(() => {
    const fetchQuestions = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await fetch('/api/questions', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token.trim().replace(/^["']|["']$/g, '')}`,
          },
          credentials: 'include',
        });

        if (response.ok) {
          const questions = await response.json();
          // Converter para formato esperado
          const formattedQuestions: Question[] = questions.map((q: any) => ({
            id: q.id,
            statement: q.statement,
            tags: q.tags || [],
          }));
          setAllQuestions(formattedQuestions);
          setFilteredQuestions(formattedQuestions);
        }
      } catch (error) {
        console.error('Erro ao buscar questões:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchQuestions();
  }, []);

  useEffect(() => {
    // Filtrar questões baseado no input e remover já selecionadas
    const selectedIds = selectedQuestions.map(q => q.id);
    const filtered = allQuestions.filter(
      (question) =>
        (question.statement.toLowerCase().includes(inputValue.toLowerCase()) ||
         (question.tags && question.tags.some(tag => 
           tag.toLowerCase().includes(inputValue.toLowerCase())
         ))) &&
        !selectedIds.includes(question.id)
    );
    setFilteredQuestions(filtered);
  }, [inputValue, allQuestions, selectedQuestions]);

  useEffect(() => {
    // Fechar dropdown ao clicar fora
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setShowDropdown(true);
  };

  const handleSelectQuestion = (question: Question) => {
    if (!selectedQuestions.find(q => q.id === question.id)) {
      onChange([...selectedQuestions, question]);
    }
    setInputValue('');
    setShowDropdown(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleRemoveQuestion = (questionId: number) => {
    onChange(selectedQuestions.filter((q) => q.id !== questionId));
  };

  const handleInputFocus = () => {
    setShowDropdown(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredQuestions.length > 0) {
      e.preventDefault();
      handleSelectQuestion(filteredQuestions[0]);
    } else if (e.key === 'Backspace' && inputValue === '' && selectedQuestions.length > 0) {
      handleRemoveQuestion(selectedQuestions[selectedQuestions.length - 1].id);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  };

  const truncateText = (text: string, maxLength: number = 60) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="relative" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
        </label>
      )}
      
      <div className="relative">
        {/* Input e chips container */}
        <div
          onClick={() => inputRef.current?.focus()}
          className="min-h-[42px] w-full px-3 py-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent cursor-text flex flex-wrap gap-2 items-center"
        >
          {/* Chips selecionados */}
          {selectedQuestions.map((question) => (
            <span
              key={question.id}
              className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm font-medium max-w-[200px]"
              title={question.statement}
            >
              <span className="truncate">{truncateText(question.statement, 30)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveQuestion(question.id);
                }}
                className="hover:bg-primary-200 rounded-full p-0.5 transition flex-shrink-0"
                aria-label={`Remover questão ${question.id}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            placeholder={selectedQuestions.length === 0 ? placeholder : ''}
            disabled={loading}
            className="flex-1 min-w-[120px] outline-none bg-transparent text-sm disabled:opacity-50"
          />

          {/* Ícone de busca/loading */}
          {loading ? (
            <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowDropdown(!showDropdown);
                if (!showDropdown) {
                  inputRef.current?.focus();
                }
              }}
              className="text-gray-400 hover:text-gray-600 transition"
            >
              <Search className={`w-5 h-5 transition-transform ${showDropdown ? 'text-primary-600' : ''}`} />
            </button>
          )}
        </div>

        {/* Dropdown */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
          >
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Carregando questões...
              </div>
            ) : filteredQuestions.length > 0 ? (
              <>
                {filteredQuestions.map((question) => (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => handleSelectQuestion(question)}
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium mb-1">{truncateText(question.statement, 80)}</div>
                    {question.tags && question.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {question.tags.slice(0, 3).map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                        {question.tags.length > 3 && (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            +{question.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </>
            ) : inputValue.trim() ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Nenhuma questão encontrada para "{inputValue}"
              </div>
            ) : allQuestions.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Nenhuma questão disponível
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                Todas as questões já foram selecionadas
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
