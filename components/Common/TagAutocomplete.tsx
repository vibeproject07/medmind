'use client';

import { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Plus, Save } from 'lucide-react';

interface TagAutocompleteProps {
  options: string[];
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  onSaveNewTag?: (tag: string) => void; // Callback para salvar nova tag nas opções
  placeholder?: string;
  label?: string;
  maxTags?: number; // Número máximo de tags permitidas
  /** Mapa opção -> cor de fundo (ex.: para destacar opções de uma área) */
  optionBackgroundMap?: Record<string, string>;
}

export default function TagAutocomplete({
  options,
  selectedTags,
  onChange,
  onSaveNewTag,
  placeholder = 'Digite para buscar ou criar tags...',
  label,
  maxTags,
  optionBackgroundMap,
}: TagAutocompleteProps) {
  const safeOptions = options ?? [];
  const safeSelectedTags = selectedTags ?? [];

  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<string[]>(safeOptions);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [pendingTag, setPendingTag] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Filtrar opções baseado no input e remover já selecionadas
    const filtered = safeOptions.filter(
      (option) =>
        option.toLowerCase().includes(inputValue.toLowerCase()) &&
        !safeSelectedTags.includes(option)
    );
    setFilteredOptions(filtered);
  }, [inputValue, safeOptions, safeSelectedTags]);

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

  const handleSelectTag = (tag: string) => {
    if (tag.trim() && !safeSelectedTags.includes(tag.trim())) {
      // Verificar limite de tags
      if (maxTags && safeSelectedTags.length >= maxTags) {
        return;
      }
      onChange([...safeSelectedTags, tag.trim()]);
    }
    setInputValue('');
    setShowDropdown(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleCreateTag = () => {
    const newTag = inputValue.trim();
    if (newTag && !safeSelectedTags.includes(newTag)) {
      // Verificar limite de tags
      if (maxTags && safeSelectedTags.length >= maxTags) {
        return;
      }
      // Verificar se é uma tag nova (não está nas opções disponíveis)
      if (!safeOptions.includes(newTag) && onSaveNewTag) {
        // Mostrar modal para salvar
        setPendingTag(newTag);
        setShowSaveModal(true);
        setInputValue('');
        setShowDropdown(false);
      } else {
        // Tag já existe ou não há callback para salvar, apenas adicionar
        onChange([...safeSelectedTags, newTag]);
        setInputValue('');
        setShowDropdown(false);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    }
  };

  const handleSaveTag = () => {
    if (pendingTag && onSaveNewTag) {
      // Verificar limite de tags
      if (maxTags && safeSelectedTags.length >= maxTags) {
        setShowSaveModal(false);
        setPendingTag('');
        return;
      }
      // Salvar a tag nas opções disponíveis
      onSaveNewTag(pendingTag);
      // Adicionar à seleção
      onChange([...safeSelectedTags, pendingTag]);
      setShowSaveModal(false);
      setPendingTag('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleUseOnce = () => {
    if (pendingTag) {
      // Verificar limite de tags
      if (maxTags && safeSelectedTags.length >= maxTags) {
        setShowSaveModal(false);
        setPendingTag('');
        return;
      }
      // Apenas usar sem salvar
      onChange([...safeSelectedTags, pendingTag]);
      setShowSaveModal(false);
      setPendingTag('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleCancelSave = () => {
    setShowSaveModal(false);
    setPendingTag('');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onChange(safeSelectedTags.filter((tag) => tag !== tagToRemove));
  };

  const handleInputFocus = () => {
    setShowDropdown(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Se há opções filtradas, seleciona a primeira
      if (filteredOptions.length > 0 && inputValue.trim()) {
        handleSelectTag(filteredOptions[0]);
      } else if (inputValue.trim()) {
        // Caso contrário, cria nova tag
        handleCreateTag();
      }
    } else if (e.key === 'Backspace' && inputValue === '' && safeSelectedTags.length > 0) {
      handleRemoveTag(safeSelectedTags[safeSelectedTags.length - 1]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    } else if (e.key === ',' || e.key === ';') {
      // Permite criar tag com vírgula ou ponto e vírgula
      e.preventDefault();
      if (inputValue.trim()) {
        handleCreateTag();
      }
    }
  };

  const canCreateTag = inputValue.trim() && 
    !safeSelectedTags.includes(inputValue.trim()) && 
    !safeOptions.includes(inputValue.trim());

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
          {safeSelectedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-700"
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(tag);
                }}
                className="hover:bg-primary-200 rounded-full p-0.5 transition"
                aria-label={`Remover ${tag}`}
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
            placeholder={selectedTags.length === 0 ? placeholder : ''}
            disabled={maxTags ? selectedTags.length >= maxTags : false}
            className="flex-1 min-w-[120px] outline-none bg-transparent text-sm disabled:cursor-not-allowed disabled:opacity-50"
          />

          {/* Ícone de dropdown */}
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
            <ChevronDown className={`w-5 h-5 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Dropdown com scroll para listas longas (áreas do conhecimento / assuntos) */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="tag-autocomplete-dropdown absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-72 overflow-y-auto overflow-x-hidden overscroll-contain"
          >
            {/* Quando há input, mostrar opções filtradas */}
            {inputValue.trim() ? (
              <>
                {/* Opções filtradas */}
                {filteredOptions.length > 0 && (
                  <>
                    {filteredOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleSelectTag(option)}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition flex items-center gap-2"
                        style={optionBackgroundMap?.[option] ? { backgroundColor: optionBackgroundMap[option] } : undefined}
                      >
                        <span>{option}</span>
                      </button>
                    ))}
                    {canCreateTag && <div className="border-t border-gray-200"></div>}
                  </>
                )}
                
                {/* Opção para criar nova tag */}
                {canCreateTag && (
                  <button
                    type="button"
                    onClick={handleCreateTag}
                    className="w-full px-4 py-2 text-left text-sm text-primary-600 hover:bg-primary-50 transition flex items-center gap-2 font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Criar "{inputValue.trim()}"</span>
                  </button>
                )}

                {/* Mensagem quando não há opções */}
                {filteredOptions.length === 0 && !canCreateTag && (
                  <div className="px-4 py-2 text-sm text-gray-500 text-center">
                    Todas as tags já foram selecionadas
                  </div>
                )}
              </>
            ) : (
              /* Quando não há input, mostrar todas as opções não selecionadas */
              <>
                {safeOptions.filter(opt => !safeSelectedTags.includes(opt)).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleSelectTag(option)}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition"
                    style={optionBackgroundMap?.[option] ? { backgroundColor: optionBackgroundMap[option] } : undefined}
                  >
                    {option}
                  </button>
                ))}
                {safeOptions.filter(opt => !safeSelectedTags.includes(opt)).length === 0 && (
                  <div className="px-4 py-2 text-sm text-gray-500 text-center">
                    Todas as tags pré-cadastradas já foram selecionadas
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Modal para salvar nova tag */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">
                Salvar nova tag?
              </h3>
            </div>
            
            <div className="px-6 py-4">
              <p className="text-gray-700 mb-4">
                Você criou uma nova tag <span className="font-semibold text-primary-600">"{pendingTag}"</span> que não existe nas opções disponíveis.
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Deseja salvar esta tag para que ela apareça nas opções futuras?
              </p>

              <div className="flex flex-col gap-2">
                {onSaveNewTag && (
                  <button
                    type="button"
                    onClick={handleSaveTag}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium"
                  >
                    <Save className="w-4 h-4" />
                    Salvar tag e usar
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleUseOnce}
                  className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                >
                  Usar apenas nesta vez
                </button>
                <button
                  type="button"
                  onClick={handleCancelSave}
                  className="w-full px-4 py-2 text-gray-500 hover:text-gray-700 transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
