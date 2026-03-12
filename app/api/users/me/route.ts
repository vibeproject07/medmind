import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }
    
    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const db = getDatabase();
    const userData = db.prepare(`
      SELECT 
        u.id, 
        u.name, 
        u.username, 
        u.email, 
        u.role, 
        u.company_id,
        u.academic_status,
        u.academic_period,
        u.institution,
        u.teaching_methodology,
        u.residency_status,
        u.residency_name,
        u.residency_year,
        u.wants_new_residency_exam,
        u.next_residency_interests,
        u.interests_tags,
        u.created_at,
        u.updated_at,
        c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?
    `).get(user.id) as any;

    if (!userData) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    return NextResponse.json({
      id: userData.id,
      name: userData.name,
      username: userData.username,
      email: userData.email,
      role: userData.role,
      company_id: userData.company_id,
      company_name: userData.company_name,
      academic_status: userData.academic_status,
      academic_period: userData.academic_period,
      institution: userData.institution,
      teaching_methodology: userData.teaching_methodology,
      residency_status: userData.residency_status,
      residency_name: userData.residency_name,
      residency_year: userData.residency_year,
      wants_new_residency_exam: userData.wants_new_residency_exam,
      next_residency_interests: userData.next_residency_interests ? JSON.parse(userData.next_residency_interests) : [],
      specialty_area: userData.specialty_area,
      wants_another_residency: userData.wants_another_residency,
      intended_residency: userData.intended_residency,
      wants_residency: userData.wants_residency,
      intended_residency_generalist: userData.intended_residency_generalist,
      has_residency: userData.has_residency,
      interests_tags: userData.interests_tags ? JSON.parse(userData.interests_tags) : [],
      created_at: userData.created_at,
      updated_at: userData.updated_at,
    });
  } catch (error) {
    console.error('Erro ao buscar informações do usuário:', error);
    return NextResponse.json({ error: 'Erro ao buscar informações do usuário' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }
    
    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await request.json();
    const { academic_status, academic_period, institution, teaching_methodology, residency_status, residency_name, residency_year, wants_new_residency_exam, specialty_area, wants_another_residency, intended_residency, wants_residency, intended_residency_generalist, has_residency, interests_tags } = body;

    // Validar academic_period apenas se academic_status for 'student'
    if (academic_status === 'student' && academic_period !== null && academic_period !== undefined) {
      if (academic_period < 1 || academic_period > 12) {
        return NextResponse.json({ 
          error: 'Período acadêmico deve estar entre 1 e 12' 
        }, { status: 400 });
      }
    }

    const db = getDatabase();
    
    // Converter interests_tags array para JSON string
    const interestsTagsJson = interests_tags && Array.isArray(interests_tags) && interests_tags.length > 0
      ? JSON.stringify(interests_tags.slice(0, 5)) // Limitar a 5 tags
      : null;

    // Converter next_residency_interests array para JSON string
    const nextResidencyInterestsJson = next_residency_interests && Array.isArray(next_residency_interests) && next_residency_interests.length > 0
      ? JSON.stringify(next_residency_interests)
      : null;

    // Atualizar apenas os campos acadêmicos
    db.prepare(`
      UPDATE users
      SET academic_status = ?,
          academic_period = ?,
          institution = ?,
          teaching_methodology = ?,
          residency_status = ?,
          residency_name = ?,
          residency_year = ?,
          wants_new_residency_exam = ?,
          next_residency_interests = ?,
          specialty_area = ?,
          wants_another_residency = ?,
          intended_residency = ?,
          wants_residency = ?,
          intended_residency_generalist = ?,
          interests_tags = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      academic_status || null,
      academic_status === 'student' ? (academic_period || null) : null,
      academic_status === 'student' ? (institution || null) : null,
      academic_status === 'student' ? (teaching_methodology || null) : null,
      residency_status || null,
      academic_status === 'resident' ? (residency_name || null) : null,
      academic_status === 'resident' ? (residency_year || null) : null,
      academic_status === 'resident' ? (wants_new_residency_exam || null) : null,
      academic_status === 'resident' && wants_new_residency_exam === 'Sim' ? nextResidencyInterestsJson : null,
      academic_status === 'specialist' ? (specialty_area || null) : null,
      academic_status === 'specialist' ? (wants_another_residency || null) : null,
      academic_status === 'specialist' ? (intended_residency || null) : null,
      academic_status === 'generalist' ? (wants_residency || null) : null,
      academic_status === 'generalist' ? (intended_residency_generalist || null) : null,
      academic_status === 'graduate' ? (has_residency || null) : null,
      interestsTagsJson,
      user.id
    );

    // Retornar dados atualizados
    const updatedUser = db.prepare(`
      SELECT 
        u.id, 
        u.name, 
        u.username, 
        u.email, 
        u.role, 
        u.company_id,
        u.academic_status,
        u.academic_period,
        u.institution,
        u.teaching_methodology,
        u.residency_status,
        u.residency_name,
        u.residency_year,
        u.wants_new_residency_exam,
        u.next_residency_interests,
        u.specialty_area,
        u.wants_another_residency,
        u.intended_residency,
        u.wants_residency,
        u.intended_residency_generalist,
        u.has_residency,
        u.interests_tags,
        u.created_at,
        u.updated_at,
        c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?
    `).get(user.id) as any;

    return NextResponse.json({
      id: updatedUser.id,
      name: updatedUser.name,
      username: updatedUser.username,
      email: updatedUser.email,
      role: updatedUser.role,
      company_id: updatedUser.company_id,
      company_name: updatedUser.company_name,
      academic_status: updatedUser.academic_status,
      academic_period: updatedUser.academic_period,
      institution: updatedUser.institution,
      teaching_methodology: updatedUser.teaching_methodology,
      residency_status: updatedUser.residency_status,
      residency_name: updatedUser.residency_name,
      residency_year: updatedUser.residency_year,
      wants_new_residency_exam: updatedUser.wants_new_residency_exam,
      next_residency_interests: updatedUser.next_residency_interests ? JSON.parse(updatedUser.next_residency_interests) : [],
      specialty_area: updatedUser.specialty_area,
      wants_another_residency: updatedUser.wants_another_residency,
      intended_residency: updatedUser.intended_residency,
      wants_residency: updatedUser.wants_residency,
      intended_residency_generalist: updatedUser.intended_residency_generalist,
      has_residency: updatedUser.has_residency,
      interests_tags: updatedUser.interests_tags ? JSON.parse(updatedUser.interests_tags) : [],
      created_at: updatedUser.created_at,
      updated_at: updatedUser.updated_at,
    });
  } catch (error) {
    console.error('Erro ao atualizar informações do usuário:', error);
    return NextResponse.json({ error: 'Erro ao atualizar informações do usuário' }, { status: 500 });
  }
}
