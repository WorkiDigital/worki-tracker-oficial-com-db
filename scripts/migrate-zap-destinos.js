/**
 * Migra zap_agendamentos (modelo antigo, 1 nível) para o modelo de 2 níveis:
 * zap_destinos (canal/conta/destino, fixo) + zap_agendamentos (vira o "relatório"
 * filho, vinculado via destino_id).
 *
 * Agrupa linhas de zap_agendamentos por (cliente_id, instance_name, destino_tipo,
 * destino_jid, account_id) — cada combinação distinta vira 1 zap_destinos, e todas
 * as linhas daquele grupo recebem o destino_id correspondente.
 *
 * Idempotente: só processa linhas com destino_id IS NULL. Pode rodar mais de uma
 * vez sem duplicar.
 *
 * Uso: node -r dotenv/config scripts/migrate-zap-destinos.js
 */
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function chaveGrupo(row) {
  return [
    row.cliente_id ?? '',
    row.instance_name ?? '',
    row.destino_tipo ?? '',
    row.destino_jid ?? '',
    row.account_id ?? '',
  ].join('||');
}

async function main() {
  console.log('📋 Migração zap_agendamentos → zap_destinos (modelo de 2 níveis)\n');

  const { rows } = await pool.query(`
    SELECT id, cliente_id, instance_name, destino_tipo, destino_jid, destino_nome, account_id
    FROM zap_agendamentos
    WHERE destino_id IS NULL
    ORDER BY id
  `);

  console.log(`📋 ${rows.length} relatório(s) legado(s) sem destino_id\n`);

  if (!rows.length) {
    console.log('✅ Nenhuma linha precisa de migração.');
    await pool.end();
    return;
  }

  const grupos = new Map();
  for (const row of rows) {
    const chave = chaveGrupo(row);
    if (!grupos.has(chave)) grupos.set(chave, { info: row, ids: [] });
    grupos.get(chave).ids.push(row.id);
  }

  console.log(`📦 ${grupos.size} destino(s) distinto(s) a criar\n`);

  let destinosCriados = 0, relatoriosVinculados = 0;

  for (const { info, ids } of grupos.values()) {
    try {
      const nome = info.destino_nome || info.destino_jid || `Destino ${info.instance_name}`;
      const { rows: destRows } = await pool.query(`
        INSERT INTO zap_destinos
          (cliente_id, nome, account_id, instance_name, destino_tipo, destino_jid, destino_nome)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id
      `, [info.cliente_id, nome, info.account_id, info.instance_name, info.destino_tipo, info.destino_jid, info.destino_nome]);

      const destinoId = destRows[0].id;
      destinosCriados++;

      await pool.query(`
        UPDATE zap_agendamentos SET destino_id = $1 WHERE id = ANY($2::int[])
      `, [destinoId, ids]);

      relatoriosVinculados += ids.length;
      console.log(`✅ Destino "${nome}" (id ${destinoId}) — ${ids.length} relatório(s) vinculado(s): [${ids.join(', ')}]`);
    } catch (e) {
      console.error(`❌ Grupo (cliente ${info.cliente_id}, instância ${info.instance_name}) — erro: ${e.message}`);
    }
  }

  console.log(`\n✅ Migração concluída: ${destinosCriados} destino(s) criado(s), ${relatoriosVinculados} relatório(s) vinculado(s).`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
