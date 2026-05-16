import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = join(__dirname, '..', 'decs_classification_results.json');
const outputPath = join(__dirname, '..', 'decs_classification_results.csv');

const data = JSON.parse(readFileSync(inputPath, 'utf-8'));

const rows = [];
rows.push(['id_question', 'role', 'term', 'name_en', 'code', 'tree_ids', 'hierarchy_path', 'scope_note'].join(','));

function esc(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/\r?\n/g, ' ');
  if (s.includes(',') || s.includes('"') || s.includes("'")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

for (const entry of data) {
  const { id_question, ai_decs_descriptors } = entry;
  if (!Array.isArray(ai_decs_descriptors) || ai_decs_descriptors.length === 0) {
    rows.push([id_question, '', '', '', '', '', '', ''].map(esc).join(','));
    continue;
  }
  for (const d of ai_decs_descriptors) {
    const treeIds = Array.isArray(d.tree_ids) ? d.tree_ids.join('; ') : (d.tree_ids ?? '');
    rows.push([
      id_question,
      d.role ?? '',
      d.term ?? '',
      d.name_en ?? '',
      d.code ?? '',
      treeIds,
      d.hierarchy_path ?? '',
      d.scope_note ?? '',
    ].map(esc).join(','));
  }
}

writeFileSync(outputPath, rows.join('\n'), 'utf-8');
console.log(`CSV gerado: ${outputPath}`);
console.log(`Total de linhas (excl. header): ${rows.length - 1}`);
