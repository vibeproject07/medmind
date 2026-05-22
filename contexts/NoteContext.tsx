'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

export type NotePanel = 'fontes' | 'estudio' | null;

interface NoteContextValue {
  noteTitle: string;
  setNoteTitle: (title: string) => void;
  notePanel: NotePanel;
  setNotePanel: (panel: NotePanel) => void;
}

const NoteContext = createContext<NoteContextValue>({
  noteTitle: '',
  setNoteTitle: () => {},
  notePanel: null,
  setNotePanel: () => {},
});

export function NoteProvider({ children }: { children: ReactNode }) {
  const [noteTitle, setNoteTitle] = useState('');
  const [notePanel, setNotePanel] = useState<NotePanel>(null);

  return (
    <NoteContext.Provider value={{ noteTitle, setNoteTitle, notePanel, setNotePanel }}>
      {children}
    </NoteContext.Provider>
  );
}

export function useNote() {
  return useContext(NoteContext);
}
