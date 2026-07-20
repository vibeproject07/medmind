/**
 * decs-compress-json.mjs — Reformata o JSON de vetorização DeCS
 *
 * - Arrays de strings    → linha única compacta
 * - embedding_vector     → 8 valores por linha
 * - Todos os campos mantidos (sem remoções)
 *
 * Usage:
 *   node scripts/decs-compress-json.mjs [--in <arquivo>] [--out <arquivo>]
 *
 * Padrão:
 *   in  = exports/decs-vectorization-200.json
 *   out = exports/decs-vectorization-200-compact.json
 */

import fs   from 'fs';
import path from 'path';

const args   = process.argv.slice(2);
const inIdx  = args.indexOf('--in');
const outIdx = args.indexOf('--out');

const IN_FILE  = inIdx  !== -1 ? args[inIdx  + 1] : 'exports/decs-vectorization-200.json';
const OUT_FILE = outIdx !== -1 ? args[outIdx + 1] : 'exports/decs-vectorization-200-compact.json';

// ── Serializador customizado ──────────────────────────────────────────────────

const VECTOR_PER_LINE   = 8;   // números por linha no embedding_vector
const STRINGS_PER_LINE  = 4;   // strings por linha em arrays de texto
const INDENT            = '  '; // 2 espaços

function isStringArray(arr) {
  return Array.isArray(arr) && arr.every(v => typeof v === 'string');
}

function isNumberArray(arr) {
  return Array.isArray(arr) && arr.every(v => typeof v === 'number');
}

/**
 * Formata um array de strings em blocos de STRINGS_PER_LINE por linha.
 * Exemplo: ["a", "b", "c", "d", \n "e", "f"]
 */
function formatStringArray(arr, baseIndent) {
  if (arr.length === 0) return '[]';
  const inner    = baseIndent + INDENT;
  const chunks   = [];
  for (let i = 0; i < arr.length; i += STRINGS_PER_LINE) {
    chunks.push(
      inner + arr.slice(i, i + STRINGS_PER_LINE).map(s => JSON.stringify(s)).join(', '),
    );
  }
  return '[\n' + chunks.join(',\n') + '\n' + baseIndent + ']';
}

/**
 * Formata embedding_vector em grupos de VECTOR_PER_LINE números por linha.
 */
function formatVector(arr, baseIndent) {
  if (arr.length === 0) return '[]';
  const inner  = baseIndent + INDENT;
  const chunks = [];
  for (let i = 0; i < arr.length; i += VECTOR_PER_LINE) {
    chunks.push(inner + arr.slice(i, i + VECTOR_PER_LINE).join(', '));
  }
  return '[\n' + chunks.join(',\n') + '\n' + baseIndent + ']';
}

/**
 * Serializa recursivamente o objeto com as regras de formatação.
 */
function serialize(value, indent, key) {
  if (value === null)             return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return String(value);
  if (typeof value === 'string')  return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (key === 'embedding_vector' && isNumberArray(value)) {
      return formatVector(value, indent);
    }
    if (isStringArray(value)) {
      return formatStringArray(value, indent);
    }
    // Arrays de objetos/mistos — indentado normal
    if (value.length === 0) return '[]';
    const inner = indent + INDENT;
    const items = value.map(v => inner + serialize(v, inner, null));
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const inner = indent + INDENT;
    const lines = entries.map(
      ([k, v]) => `${inner}${JSON.stringify(k)}: ${serialize(v, inner, k)}`,
    );
    return '{\n' + lines.join(',\n') + '\n' + indent + '}';
  }

  return JSON.stringify(value);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(IN_FILE)) {
  console.error(`❌ Arquivo não encontrado: ${IN_FILE}`);
  process.exit(1);
}

console.log(`📂 Lendo  : ${IN_FILE}`);
const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));

console.log(`🔧 Reformatando...`);
const compact = serialize(data, '');

const outDir = path.dirname(OUT_FILE);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUT_FILE, compact + '\n', 'utf-8');

const inMB  = (fs.statSync(IN_FILE).size  / 1024 / 1024).toFixed(2);
const outMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);

console.log(`✅ Arquivo gerado: ${OUT_FILE}`);
console.log(`   Original  : ${inMB} MB`);
console.log(`   Compacto  : ${outMB} MB`);
