import { verifyAuth } from './_auth.js';
import { getPool } from './_db.js';
import { cors } from './_cors.js';

export default async function handler(req, res) {
  if (cors(req, res, ['GET', 'POST', 'DELETE'])) return;

  const user = await verifyAuth(req, res);
  if (!user) return;

  const pool = getPool();
  const method = req.method;

  try {
    if (method === 'GET') {
      // Listar relatórios do cliente
      const result = await pool.query(
        'SELECT * FROM relatorios_agendados WHERE cliente_id = $1 ORDER BY created_at DESC',
        [user.cliente_id]
      );
      return res.status(200).json(result.rows);
    }

    if (method === 'POST') {
      // Criar novo agendamento
      const { instance_name, target_jid, is_group, nome_destino, metricas, frequencia, horario_envio, mensagem_template } = req.body;

      if (!instance_name || !target_jid || !horario_envio) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
      }

      const result = await pool.query(
        `INSERT INTO relatorios_agendados 
        (cliente_id, instance_name, target_jid, is_group, nome_destino, metricas, frequencia, horario_envio, mensagem_template) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
            user.cliente_id, 
            instance_name, 
            target_jid, 
            is_group || false, 
            nome_destino || target_jid, 
            JSON.stringify(metricas), 
            frequencia || 'diario', 
            horario_envio,
            mensagem_template || null
        ]
      );
      return res.status(201).json(result.rows[0]);
    }

    if (method === 'DELETE') {
      // Deletar agendamento
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID é obrigatório.' });

      const result = await pool.query(
        'DELETE FROM relatorios_agendados WHERE id = $1 AND cliente_id = $2 RETURNING id',
        [id, user.cliente_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Relatório não encontrado ou não pertence a este usuário.' });
      }

      return res.status(200).json({ success: true, message: 'Relatório deletado com sucesso.' });
    }

    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (error) {
    console.error('[reports-config] Erro:', error);
    return res.status(500).json({ error: error.message });
  }
}
