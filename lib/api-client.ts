// Helper para fazer requisições autenticadas (apenas para uso no cliente)
export async function authenticatedFetch(url: string, options: RequestInit = {}) {
  if (typeof window === 'undefined') {
    throw new Error('authenticatedFetch só pode ser usado no cliente');
  }

  const token = localStorage.getItem('token');
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers as HeadersInit || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  return response;
}

