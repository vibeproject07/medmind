/**
 * Script one-off: adiciona a tag "Ciclo básico" a todas as questões no banco.
 * Executar na raiz do projeto: node adicionar-tag-ciclo-basico.js
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'medmind.db');
const db = new Database(dbPath);

const TAG = 'Ciclo básico';

const rows = db.prepare('SELECT id, tags FROM questions').all();
let updated = 0;

const updateStmt = db.prepare("UPDATE questions SET tags = ?, updated_at = datetime('now') WHERE id = ?");

const run = db.transaction(() => {
  for (const row of rows) {
    let tags = [];
    if (row.tags) {
      try {
        tags = JSON.parse(row.tags);
        if (!Array.isArray(tags)) tags = [];
      } catch {
        tags = [];
      }
    }
    const tagLower = TAG.toLowerCase();
    if (tags.some((t) => String(t).toLowerCase() === tagLower)) continue;
    tags.push(TAG);
    updateStmt.run(JSON.stringify(tags), row.id);
    updated++;
  }
});

run();
console.log(`Tag "${TAG}" adicionada a ${updated} de ${rows.length} questões.`);
db.close();
