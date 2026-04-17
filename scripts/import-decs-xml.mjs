/**
 * Import DeCS 2026 descriptors from bireme_decs_por2026.xml (inside TGZ)
 * into the decs_descriptors PostgreSQL table.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-decs-xml.mjs [--resume]
 *
 * Options:
 *   --resume   Skip descriptors already in the DB (default: upsert all)
 *
 * No external XML library needed — uses streaming regex parsing.
 */

import { execFileSync } from 'child_process';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TGZ_PATH  = path.join(__dirname, '../attached_assets/decs_pt_2026_1776458030474.tgz');
const XML_FILE  = 'bireme_decs_por2026.xml';
const BATCH_SIZE = 200;
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
  await pool.query(`CREATE INDEX IF NOT EXISTS decs_descriptors_name_pt_idx ON decs_descriptors USING gin(to_tsvector('portuguese', name_pt))`);
}

// ── XML record parser (regex-based, no external library) ─────────────────────

function extractCDATA(xml, outerTag) {
  const re = new RegExp(`<${outerTag}[^>]*>[\\s\\S]*?<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function extractAllCDATA(xml) {
  const results = [];
  const re = /<!\\[CDATA\\[([\s\S]*?)\]\]>/g;
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function parseRecord(xml) {
  // DescriptorUI
  const uiMatch = xml.match(/<DescriptorUI>(D\w+)<\/DescriptorUI>/);
  if (!uiMatch) return null;
  const ui = uiMatch[1];

  // DescriptorClass attribute
  const classMatch = xml.match(/DescriptorClass="(\d+)"/);
  const descriptor_class = classMatch ? classMatch[1] : '1';

  // Descriptor name from DescriptorName/String CDATA
  const nameRaw = extractCDATA(xml, 'DescriptorName');
  const ptEnMatch = nameRaw.match(/^(.+?)\[(.+?)\]\s*$/);
  const name_pt = ptEnMatch ? ptEnMatch[1].trim() : nameRaw;
  const name_en = ptEnMatch ? ptEnMatch[2].trim() : '';

  // Tree numbers
  const tree_numbers = [];
  const treeRe = /<TreeNumber>([^<]+)<\/TreeNumber>/g;
  let m;
  while ((m = treeRe.exec(xml)) !== null) tree_numbers.push(m[1].trim());

  // Entry terms from ConceptList — all CDATA String values
  const entry_terms = [];
  const conceptBlock = xml.match(/<ConceptList>([\s\S]*?)<\/ConceptList>/);
  if (conceptBlock) {
    const termRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
    while ((m = termRe.exec(conceptBlock[1])) !== null) {
      const t = m[1].trim();
      if (t && !entry_terms.includes(t)) entry_terms.push(t);
    }
  }

  // Scope note
  const scopeBlock = xml.match(/<ScopeNote>([\s\S]*?)<\/ScopeNote>/);
  let scope_note = '';
  if (scopeBlock) {
    const cdataM = scopeBlock[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    scope_note = cdataM ? cdataM[1].trim() : scopeBlock[1].replace(/<[^>]+>/g, '').trim();
  }

  // See related descriptors
  const see_related = [];
  const seeBlock = xml.match(/<SeeRelatedList>([\s\S]*?)<\/SeeRelatedList>/);
  if (seeBlock) {
    const relRe = /<DescriptorUI>(D\w+)<\/DescriptorUI>/g;
    while ((m = relRe.exec(seeBlock[1])) !== null) see_related.push(m[1]);
  }

  // Qualifiers
  const qualifiers = [];
  const qualRe = /<QualifierUI>(Q\w+)<\/QualifierUI>/g;
  while ((m = qualRe.exec(xml)) !== null) qualifiers.push(m[1]);

  // Date established
  let date_established = null;
  const estBlock = xml.match(/<DateEstablished>([\s\S]*?)<\/DateEstablished>/);
  if (estBlock) {
    const y  = estBlock[1].match(/<Year>(\d+)<\/Year>/)?.[1];
    const mo = estBlock[1].match(/<Month>(\d+)<\/Month>/)?.[1] ?? '01';
    const d  = estBlock[1].match(/<Day>(\d+)<\/Day>/)?.[1]   ?? '01';
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
          (ui, name_pt, name_en, descriptor_class, scope_note, entry_terms, tree_numbers, see_related, qualifiers, date_established)
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🗄️  DeCS 2026 — Import para PostgreSQL');
  console.log(`   Arquivo: ${TGZ_PATH}`);
  console.log(`   Modo   : ${RESUME ? 'resume (skip existentes)' : 'upsert tudo'}\n`);

  await ensureTable();
  console.log('✅ Tabela decs_descriptors pronta\n');

  // Get existing UIs if resume mode
  let existingUIs = new Set();
  if (RESUME) {
    const { rows } = await pool.query('SELECT ui FROM decs_descriptors');
    existingUIs = new Set(rows.map(r => r.ui));
    console.log(`📋 ${existingUIs.size} descritores já existem no DB (serão pulados)`);
  }

  // Extract XML from TGZ (379MB decompressed — managed in memory)
  console.log('📦 Extraindo XML do TGZ...');
  const startExtract = Date.now();
  let xmlContent;
  try {
    xmlContent = execFileSync('tar', ['-xOf', TGZ_PATH, XML_FILE], {
      maxBuffer: 500 * 1024 * 1024,
    }).toString('utf8');
  } catch (e) {
    console.error('Erro ao extrair TGZ:', e.message);
    process.exit(1);
  }
  console.log(`✅ XML carregado (${(xmlContent.length / 1024 / 1024).toFixed(1)} MB) em ${((Date.now()-startExtract)/1000).toFixed(1)}s\n`);

  // Parse all DescriptorRecord blocks
  console.log('🔍 Parseando registros DeCS...');
  const startParse = Date.now();
  const recRe = /<DescriptorRecord[^>]*>[\s\S]*?<\/DescriptorRecord>/g;
  const records = [];
  let m;
  while ((m = recRe.exec(xmlContent)) !== null) {
    const rec = parseRecord(m[0]);
    if (rec && !(RESUME && existingUIs.has(rec.ui))) {
      records.push(rec);
    }
  }
  console.log(`✅ ${records.length} registros parseados em ${((Date.now()-startParse)/1000).toFixed(1)}s\n`);

  if (records.length === 0) {
    console.log('✅ Nada a importar.');
    await pool.end();
    return;
  }

  // Insert in batches
  console.log(`📥 Inserindo ${records.length} registros em batches de ${BATCH_SIZE}...`);
  const startInsert = Date.now();
  let inserted = 0, errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      const ok = await insertBatch(batch);
      inserted += ok;
    } catch (e) {
      errors++;
      console.error(`\n❌ Erro no batch ${i/BATCH_SIZE}: ${e.message}`);
    }
    process.stdout.write(
      `\r⏳ ${inserted}/${records.length} inseridos | ${errors} erros | ${((Date.now()-startInsert)/1000).toFixed(0)}s  `
    );
  }

  console.log(`\n\n🎉 Importação concluída!`);
  console.log(`   Inseridos : ${inserted}`);
  console.log(`   Erros     : ${errors}`);
  console.log(`   Duração   : ${((Date.now()-startInsert)/1000).toFixed(1)}s`);
  console.log(`\n💡 Próximo passo: node --env-file=.env.local scripts/embed-decs-descriptors.mjs`);

  await pool.end();
}

main().catch((e) => { console.error('\n💥 Fatal:', e); process.exit(1); });
