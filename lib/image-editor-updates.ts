export type ImageListUpdate = string[] | ((currentImages: string[]) => string[]);

export function appendImages(imagesToAdd: string[]): (currentImages: string[]) => string[] {
  return (currentImages) => [...currentImages, ...imagesToAdd];
}

export function removeImageAt(index: number): (currentImages: string[]) => string[] {
  return (currentImages) =>
    currentImages.filter((_, imageIndex) => imageIndex !== index);
}