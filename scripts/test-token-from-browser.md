# Como testar o token diretamente no navegador

## Passo 1: Abra o console do navegador (F12)

## Passo 2: Execute este código para verificar o token atual:

```javascript
const token = localStorage.getItem('token');
console.log('Token atual:', {
  existe: !!token,
  tipo: typeof token,
  tamanho: token?.length,
  inicio: token?.substring(0, 30),
  partes: token?.split('.').length,
  temAspas: token?.startsWith('"') || token?.endsWith('"')
});
```

## Passo 3: Teste o token diretamente na API:

```javascript
const token = localStorage.getItem('token')?.trim().replace(/^["']|["']$/g, '');

fetch('/api/debug-token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ token })
})
.then(r => r.json())
.then(data => console.log('Resultado:', data))
.catch(err => console.error('Erro:', err));
```

## Passo 4: Se o token estiver inválido, limpe e faça login novamente:

```javascript
localStorage.removeItem('token');
document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
location.href = '/login';
```

