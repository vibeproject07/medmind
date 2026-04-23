import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MedMind - Plataforma de Estudos Médicos',
  description: 'Plataforma para estudantes e profissionais de medicina organizarem cases e materiais de estudo com IA',
  viewport: 'width=device-width, initial-scale=1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="overflow-x-hidden">
      <head>
        <meta name="color-scheme" content="only light" />
      </head>
      <body className="overflow-x-hidden min-h-screen">{children}</body>
    </html>
  )
}

