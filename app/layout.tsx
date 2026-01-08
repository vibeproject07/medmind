import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MedMind - Plataforma de Estudos Médicos',
  description: 'Plataforma para estudantes e profissionais de medicina organizarem cases e materiais de estudo com IA',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}

