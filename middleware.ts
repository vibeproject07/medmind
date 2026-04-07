import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Middleware simplificado - não pode usar verifyToken aqui porque roda no Edge Runtime
// A validação completa do token é feita nas rotas da API que usam Node.js runtime
export function middleware(request: NextRequest) {
  // Rotas públicas - permitir acesso direto
  if (request.nextUrl.pathname === '/' || 
      request.nextUrl.pathname.startsWith('/login') ||
      request.nextUrl.pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Para rotas protegidas, apenas verificar se há token presente
  // A validação real do token é feita nas rotas da API ou no cliente
  const token = request.cookies.get('token')?.value || 
                request.headers.get('authorization')?.replace('Bearer ', '');

  // Dashboard - permitir acesso, o cliente vai validar
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.next();
  }

  // APIs protegidas - apenas verificar presença do token
  // A validação completa é feita na própria rota da API
  if (request.nextUrl.pathname.startsWith('/api/') && 
      !request.nextUrl.pathname.startsWith('/api/auth')) {
    if (!token) {
      return NextResponse.json({ error: 'Não autorizado - Token não fornecido' }, { status: 401 });
    }
    // Token presente, deixar a rota da API validar
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

