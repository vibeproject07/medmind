-- Prova 20 (FK das questões do dump) + admin local.

INSERT INTO provas (id, nome, banca, regiao, ano, tipo)
VALUES (20, 'ABC - SP - 2025 - MASTOLOGIA', 'ABC', 'SP', '2025', 'MASTOLOGIA')
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.provas', 'id'),
  COALESCE((SELECT MAX(id) FROM public.provas), 1),
  (SELECT MAX(id) FROM public.provas) IS NOT NULL
);

-- Senha: a123456 (mesmo seed de scripts/neon/seed.js)
INSERT INTO users (name, username, email, password, role, email_verified)
VALUES (
  'Administrador',
  'admin',
  'admin',
  '$2a$10$ojYcaClpeLpMYSlhXpZDeeOeSr.lGrtFfX4UbmBIaRknMDhmU68tW',
  'admin',
  1
)
ON CONFLICT (email) DO NOTHING;
