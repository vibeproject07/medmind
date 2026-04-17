/**
 * Import DeCS 2026 descriptors from bireme_decs_por2026.xml (inside TGZ)
 * into the decs_descriptors PostgreSQL table.
 *
 * Uses streaming (tar pipe) to avoid loading 360MB into Node.js heap.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-decs-xml.mjs [--resume]
 *
 * Options:
 *   --resume   Skip descriptors already in the DB
 */

import { spawn } from 'child_process';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TGZ_PATH  = path.join(__dirname, '../attached_assets/decs_pt_2026_1776458030474.tgz');
const XML_FILE  = 'bireme_decs_por2026.xml';
const BATCH_SIZE = 300;
const RESUME     = process.argv.includes('--resume');

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Table setup ───────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decs_descriptors (
      id               SERIAL PRIMARY KEY,
      ui               TEXT    NOT NULL,
      name_pt          TEXT    NOT NULL DEFAULT '',
      name_en          TEXT    NOT NULL DEFAULT '',
      descriptor_class TEXT    NOT NULL DEFAULT '1',
      scope_note       TEXT    NOT NULL DEFAULT '',
      entry_terms      JSONB   NOT NULL DEFAULT '[]'::jsonb,
      tree_numbers     JSONB   NOT NULL DEFAULT '[]'::jsonb,
      see_related      JSONB   NOT NULL DEFAULT '[]'::jsonb,
      qualifiers       JSONB   NOT NULL DEFAULT '[]'::jsonb,
      date_established TEXT,
      embedding        vector(3072),
      created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS decs_descriptors_ui_idx ON decs_descriptors(ui)`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS decs_descriptors_name_pt_idx
    ON decs_descriptors USING gin(to_tsvector('portuguese', name_pt))
  `);
}

// ── Record parser ─────────────────────────────────────────────────────────────

function cdataOf(xml) {
  const m = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : '';
}

function allCdataOf(xml) {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function textOf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
}

function allTextOf(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function parseRecord(xml) {
  const ui = textOf(xml, 'DescriptorUI');
  if (!ui || !ui.startsWith('D')) return null;

  const classMatch = xml.match(/DescriptorClass="(\d+)"/);
  const descriptor_class = classMatch ? classMatch[1] : '1';

  const nameBlock = xml.match(/<DescriptorName>([\s\S]*?)<\/DescriptorName>/);
  const nameRaw   = nameBlock ? cdataOf(nameBlock[1]) : '';
  const ptEnMatch = nameRaw.match(/^(.+?)\[(.+?)\]\s*$/);
  const name_pt   = ptEnMatch ? ptEnMatch[1].trim() : nameRaw;
  const name_en   = ptEnMatch ? ptEnMatch[2].trim() : '';

  const tree_numbers = allTextOf(xml, 'TreeNumber');

  const conceptBlock = xml.match(/<ConceptList>([\s\S]*?)<\/ConceptList>/);
  const entry_terms  = conceptBlock ? allCdataOf(conceptBlock[1]) : [];

  const scopeBlock = xml.match(/<ScopeNote>([\s\S]*?)<\/ScopeNote>/);
  let scope_note = '';
  if (scopeBlock) {
    scope_note = cdataOf(scopeBlock[1]) || scopeBlock[1].replace(/<[^>]+>/g, '').trim();
  }

  const seeBlock   = xml.match(/<SeeRelatedList>([\s\S]*?)<\/SeeRelatedList>/);
  const see_related = seeBlock
    ? allTextOf(seeBlock[1], 'DescriptorUI').filter(v => v.startsWith('D'))
    : [];

  const qualifiers = allTextOf(xml, 'QualifierUI').filter(v => v.startsWith('Q'));

  let date_established = null;
  const estBlock = xml.match(/<DateEstablished>([\s\S]*?)<\/DateEstablished>/);
  if (estBlock) {
    const y  = textOf(estBlock[1], 'Year');
    const mo = textOf(estBlock[1], 'Month') || '01';
    const d  = textOf(estBlock[1], 'Day')   || '01';
    if (y) date_established = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  return { ui, name_pt, name_en, descriptor_class, scope_note,
           entry_terms, tree_numbers, see_related, qualifiers, date_established };
}

// ── Batch insert ──────────────────────────────────────────────────────────────

async function insertBatch(records) {
  if (records.length === 0) return 0;
  const client = await pool.connect();
  let ok = 0;
  try {
    await client.query('BEGIN');
    for (const r of records) {
      await client.query(`
        INSERT INTO decs_descriptors
          (ui, name_pt, name_en, descriptor_class, scope_note,
           entry_terms, tree_numbers, see_related, qualifiers, date_established)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (ui) DO UPDATE SET
          name_pt          = EXCLUDED.name_pt,
          name_en          = EXCLUDED.name_en,
          descriptor_class = EXCLUDED.descriptor_class,
          scope_note       = EXCLUDED.scope_note,
          entry_terms      = EXCLUDED.entry_terms,
          tree_numbers     = EXCLUDED.tree_numbers,
          see_related      = EXCLUDED.see_related,
          qualifiers       = EXCLUDED.qualifiers,
          date_established = EXCLUDED.date_established
      `, [
        r.ui, r.name_pt, r.name_en, r.descriptor_class,
        r.scope_note.slice(0, 8000),
        JSON.stringify(r.entry_terms),
        JSON.stringify(r.tree_numbers),
        JSON.stringify(r.see_related),
        JSON.stringify(r.qualifiers),
        r.date_established,
      ]);
      ok++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return ok;
}

// ── Streaming import ──────────────────────────────────────────────────────────

async function streamImport(existingUIs) {
  const CLOSE_TAG = '</DescriptorRecord>';
  const OPEN_TAG  = '<DescriptorRecord';

  let buffer  = '';
  const batch = [];
  let parsed = 0, inserted = 0, errors = 0;

  // Serialise all DB writes through a promise chain so we can safely pause/resume
  let dbChain  = Promise.resolve();
  const start  = Date.now();

  function printProgress() {
    const s = ((Date.now() - start) / 1000).toFixed(0);
    process.stdout.write(`\r⏳ ${inserted} inseridos | ${parsed} parseados | ${errors} erros | ${s}s  `);
  }

  function flushBatch() {
    if (batch.length === 0) return;
    const toInsert = batch.splice(0); // drain
    dbChain = dbChain
      .then(() => insertBatch(toInsert))
      .then((ok) => {
        inserted += ok;
        printProgress();
      })
      .catch((e) => {
        errors++;
        process.stdout.write(`\n❌ Batch insert error: ${e.message}\n`);
      });
  }

  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xOf', TGZ_PATH, XML_FILE]);

    tar.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) process.stderr.write(`tar: ${msg}\n`);
    });

    tar.on('error', reject);

    tar.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      let closeIdx;
      while ((closeIdx = buffer.indexOf(CLOSE_TAG)) !== -1) {
        const end      = closeIdx + CLOSE_TAG.length;
        const openIdx  = buffer.lastIndexOf(OPEN_TAG, closeIdx);
        const recXml   = openIdx !== -1 ? buffer.slice(openIdx, end) : null;
        buffer         = buffer.slice(end);

        if (!recXml) continue;

        const rec = parseRecord(recXml);
        if (!rec || (RESUME && existingUIs.has(rec.ui))) continue;

        batch.push(rec);
        parsed++;

        if (batch.length >= BATCH_SIZE) {
          tar.stdout.pause();
          flushBatch();
          dbChain.then(() => tar.stdout.resume());
        }
      }

      // Keep buffer bounded — drop content before the last open tag
      const lastOpen = buffer.lastIndexOf(OPEN_TAG);
      if (lastOpen > 50_000) buffer = buffer.slice(lastOpen);
    });

    tar.stdout.on('end', () => {
      flushBatch(); // flush remainder
      dbChain.then(resolve).catch(reject);
    });
  });

  return { parsed, inserted, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🗄️  DeCS 2026 — Import para PostgreSQL (streaming)');
  console.log(`   Arquivo: ${TGZ_PATH}`);
  console.log(`   Modo   : ${RESUME ? 'resume (skip existentes)' : 'upsert tudo'}\n`);

  await ensureTable();
  console.log('✅ Tabela decs_descriptors pronta\n');

  let existingUIs = new Set();
  if (RESUME) {
    const { rows } = await pool.query('SELECT ui FROM decs_descriptors');
    existingUIs = new Set(rows.map(r => r.ui));
    console.log(`📋 ${existingUIs.size} descritores já existem (serão pulados)\n`);
  }

  console.log('📥 Iniciando streaming XML → PostgreSQL...\n');
  const start = Date.now();
  const { parsed, inserted, errors } = await streamImport(existingUIs);
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n\n🎉 Importação concluída!`);
  console.log(`   Parseados : ${parsed}`);
  console.log(`   Inseridos : ${inserted}`);
  console.log(`   Erros     : ${errors}`);
  console.log(`   Duração   : ${duration}s`);
  if (errors > 0) console.log(`\n⚠️  Re-execute com --resume para processar apenas os que falharam.`);
  console.log(`\n💡 Próximo: node --env-file=.env.local scripts/embed-decs-descriptors.mjs`);

  await pool.end();
}

main().catch((e) => { console.error('\n💥 Fatal:', e); process.exit(1); });
