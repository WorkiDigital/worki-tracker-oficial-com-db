/**
 * Script retroativo: remove emojis/símbolos decorativos do campo `nome` dos
 * leads já salvos em leads_tracking. Idempotente — só altera o que ainda
 * precisar de limpeza (compara o nome atual com a versão sanitizada).
 *
 * Uso:
 *   node -r dotenv/config scripts/clean-lead-names.js                       (dry-run, padrão)
 *   CLEAN_DRY_RUN=false node -r dotenv/config scripts/clean-lead-names.js   (aplica de verdade)
 *
 * Filtros opcionais via env:
 *   CLEAN_INSTANCIA=nome-instancia   (filtra por instância)
 */
import 'dotenv/config';
import pkg from 'pg';
import { limparTextoDecorativo } from '../api/_text-sanitize.js';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const INSTANCIA = process.env.CLEAN_INSTANCIA || null;
const DRY_RUN   = process.env.CLEAN_DRY_RUN !== 'false';

async function main() {
  console.log('🧹 Limpeza retroativa de nomes de leads (remove emojis/símbolos decorativos)');
  console.log(`   Instância : ${INSTANCIA || 'todas'}`);
  console.log(`   Modo      : ${DRY_RUN ? 'DRY RUN (sem gravação)' : 'APLICANDO ALTERAÇÕES'}\n`);

  const where  = [`nome IS NOT NULL`, `nome <> ''`];
  const params = [];
  if (INSTANCIA) { params.push(INSTANCIA); where.push(`instancia = $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT id, nome FROM leads_tracking WHERE ${where.join(' AND ')} ORDER BY id`,
    params
  );

  console.log(`📋 ${rows.length} lead(s) com nome preenchido para analisar\n`);

  let alterados = 0, jaLimpos = 0, erros = 0;

  for (const lead of rows) {
    const nomeLimpo = limparTextoDecorativo(lead.nome);
    if (nomeLimpo === lead.nome) { jaLimpos++; continue; }

    console.log(`  ${DRY_RUN ? '[DRY]' : '✅'} #${lead.id}: "${lead.nome}" → "${nomeLimpo}"`);

    if (!DRY_RUN) {
      try {
        await pool.query('UPDATE leads_tracking SET nome = $1 WHERE id = $2', [nomeLimpo, lead.id]);
      } catch (e) {
        console.error(`  ❌ #${lead.id}: erro ao atualizar — ${e.message}`);
        erros++;
        continue;
      }
    }
    alterados++;
  }

  console.log(`\n✅ Concluído: ${alterados} nome(s) ${DRY_RUN ? 'seriam alterados' : 'alterados'}, ${jaLimpos} já estavam limpos${erros ? `, ${erros} erro(s)` : ''}.`);
  if (DRY_RUN) console.log('[DRY RUN] Nenhuma alteração foi gravada. Rode com CLEAN_DRY_RUN=false para aplicar.');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
