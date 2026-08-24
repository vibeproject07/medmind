'use client';

import { useRef } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import ImageLightbox from '@/components/Common/ImageLightbox';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
type ImageListUpdate = string[] | ((currentImages: string[]) => string[]);

interface ImageEditorFieldProps {
  images: string[];
  onChange: (update: ImageListUpdate) => void;
  inputId: string;
  label?: string;
  compact?: boolean;
  onError?: (message: string) => void;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Não foi possível ler a imagem.'));
    };
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

export default function ImageEditorField({
  images,
  onChange,
  inputId,
  label = 'Imagens',
  compact = false,
  onError,
}: ImageEditorFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const reportError = (message: string) => {
    if (onError) onError(message);
    else window.alert(message);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const invalidFiles = files.filter(
      (file) => !file.type.startsWith('image/') || file.size > MAX_IMAGE_SIZE,
    );
    const validFiles = files.filter(
      (file) => file.type.startsWith('image/') && file.size <= MAX_IMAGE_SIZE,
    );

    if (invalidFiles.length > 0) {
      const tooLarge = invalidFiles.some((file) => file.size > MAX_IMAGE_SIZE);
      const invalidType = invalidFiles.some((file) => !file.type.startsWith('image/'));
      const reasons = [
        invalidType ? 'selecione apenas arquivos de imagem' : '',
        tooLarge ? 'use imagens de até 10 MB' : '',
      ].filter(Boolean);
      reportError(`Não foi possível adicionar ${invalidFiles.length === 1 ? 'o arquivo' : 'os arquivos'}. ${reasons.join(' e ')}.`);
    }

    if (validFiles.length > 0) {
      try {
        const dataUrls = await Promise.all(validFiles.map(readAsDataUrl));
        onChange((currentImages) => [...currentImages, ...dataUrls]);
      } catch (error) {
        reportError(error instanceof Error ? error.message : 'Não foi possível ler as imagens.');
      }
    }

    if (inputRef.current) inputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    onChange((currentImages) => currentImages.filter((_, imageIndex) => imageIndex !== index));
  };

  return (
    <div className="space-y-2">
      <p className="block text-sm font-medium text-gray-700">{label}</p>
      <div className={`border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-400 transition-colors ${compact ? 'p-3' : 'p-4'}`}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="sr-only"
          id={inputId}
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`w-full flex flex-col items-center justify-center cursor-pointer rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${compact ? 'py-2' : 'py-4'}`}
        >
          <ImageIcon className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} text-gray-400 mb-2`} />
          <span className="text-sm text-gray-600 font-medium">
            Clique para adicionar imagens
          </span>
          <span className="text-xs text-gray-500 mt-1">PNG, JPG, GIF até 10MB</span>
        </button>
      </div>

      {images.length > 0 && (
        <div className={`grid grid-cols-2 ${compact ? 'md:grid-cols-4' : 'md:grid-cols-3 lg:grid-cols-4'} gap-3`}>
          {images.map((image, index) => (
            <div key={`${image.slice(0, 48)}-${index}`} className="relative group">
              <ImageLightbox
                src={image}
                alt={`Preview ${index + 1}`}
                className={`w-full ${compact ? 'h-28' : 'h-32'}`}
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1 transition"
                aria-label={`Remover imagem ${index + 1}`}
                title="Remover imagem"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}