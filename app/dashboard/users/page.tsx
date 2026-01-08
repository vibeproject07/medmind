'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
// Removido authenticatedFetch - usando fetch direto

interface User {
  id: number;
  name: string;
  username?: string | null;
  email: string;
  role: 'admin' | 'manager' | 'regular';
  company_id?: number | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ name: '', username: '', email: '', password: '', role: 'regular' as 'admin' | 'manager' | 'regular', company_id: '' });

  useEffect(() => {
    // Obter usuário atual do token
    const token = localStorage.getItem('token');
    if (token) {
      try {
        // Decodificar o token JWT (apenas para obter o role no frontend)
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUser({
          id: payload.id,
          name: '',
          email: payload.email,
          role: payload.role,
          company_id: payload.company_id || null,
        });
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
      }
    }
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      let token = localStorage.getItem('token');
      if (!token) {
        setUsers([]);
        setLoading(false);
        return;
      }

      // Limpar token: remover espaços e possíveis aspas
      token = token.trim().replace(/^["']|["']$/g, '');
      
      // Validar formato básico do JWT
      if (token.split('.').length !== 3) {
        console.error('❌ Token com formato inválido na busca de usuários');
        setUsers([]);
        setLoading(false);
        return;
      }

      console.log('📤 Buscando usuários com token:', token.substring(0, 30) + '...');

      const response = await fetch('/api/users', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Erro na API:', errorData);
        setUsers([]);
        setLoading(false);
        return;
      }

      const data = await response.json();
      
      // Garantir que data é um array
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        console.error('Resposta da API não é um array:', data);
        setUsers([]);
      }
    } catch (error) {
      console.error('Erro ao buscar usuários:', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let token = localStorage.getItem('token');
    
    if (!token) {
      alert('Token não encontrado. Faça login novamente.');
      window.location.href = '/login';
      return;
    }

    // Limpar token de espaços e possíveis aspas
    token = token.trim().replace(/^["']|["']$/g, '');
    
    // Validar formato básico do JWT
    if (!token || token.split('.').length !== 3) {
      console.error('❌ Token com formato inválido:', token.substring(0, 50));
      alert('Token inválido. Faça login novamente.');
      localStorage.removeItem('token');
      window.location.href = '/login';
      return;
    }

    const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
    const method = editingUser ? 'PUT' : 'POST';

    try {
      console.log('📤 Enviando requisição:', {
        url,
        method,
        tokenLength: token.length,
        tokenStart: token.substring(0, 30) + '...',
        formData
      });

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          ...formData,
          company_id: formData.company_id ? parseInt(formData.company_id) : null
        }),
      });

      console.log('📥 Resposta recebida:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      // Verificar status antes de tentar parsear JSON
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('Erro ao salvar usuário:', { status: response.status, error: errorData });
        alert(errorData.error || 'Erro ao salvar usuário');
        
        // Se o erro for de token inválido, redirecionar para login
        if (response.status === 401) {
          localStorage.removeItem('token');
          document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);
        }
        return;
      }

      const data = await response.json();
      console.log('Usuário salvo com sucesso:', data);

      fetchUsers();
      setShowModal(false);
      setEditingUser(null);
      setFormData({ name: '', username: '', email: '', password: '', role: 'regular', company_id: '' });
    } catch (error) {
      console.error('Erro ao salvar usuário:', error);
      alert('Erro de conexão. Tente novamente.');
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ 
      name: user.name,
      username: user.username || '',
      email: user.email, 
      password: '', 
      role: user.role,
      company_id: user.company_id?.toString() || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        alert('Token não encontrado. Faça login novamente.');
        window.location.href = '/login';
        return;
      }

      const response = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
        },
        credentials: 'include',
      });

      if (response.ok) {
        fetchUsers();
      }
    } catch (error) {
      console.error('Erro ao excluir usuário:', error);
    }
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Usuários</h1>
        <button
          onClick={() => {
            setEditingUser(null);
            setFormData({ name: '', username: '', email: '', password: '', role: 'regular', company_id: '' });
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus className="w-5 h-5" />
          Novo Usuário
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Perfil</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Empresa</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {Array.isArray(users) && users.length > 0 ? (
              users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.id}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.username || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.email}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      user.role === 'admin' ? 'bg-red-100 text-red-800' :
                      user.role === 'manager' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {user.role === 'admin' ? 'Admin' : user.role === 'manager' ? 'Manager' : 'Regular'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {user.company_id ? `ID: ${user.company_id}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => handleEdit(user)}
                      className="text-primary-600 hover:text-primary-900 mr-4"
                    >
                      <Edit className="w-4 h-4 inline" />
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="w-4 h-4 inline" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500">
                  {loading ? 'Carregando...' : 'Nenhum usuário encontrado'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">
              {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="Opcional"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {editingUser ? 'Nova Senha (deixe em branco para manter)' : 'Senha'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Perfil</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'manager' | 'regular' })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  disabled={!currentUser || currentUser.role !== 'admin'}
                >
                  <option value="regular">Regular</option>
                  {currentUser?.role === 'admin' && (
                    <>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </>
                  )}
                </select>
                {currentUser?.role !== 'admin' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Apenas administradores podem criar managers ou admins
                  </p>
                )}
              </div>
              {formData.role === 'manager' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ID da Empresa</label>
                  <input
                    type="number"
                    value={formData.company_id}
                    onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                    placeholder="ID da empresa (será implementado em breve)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <p className="text-xs text-gray-500 mt-1">O CRUD de empresas será implementado em breve</p>
                </div>
              )}
              <div className="flex gap-4">
                <button
                  type="submit"
                  className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingUser(null);
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

