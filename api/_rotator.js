/**
 * Rotador de destinos de WhatsApp para um link rastreável.
 * Modos: single | round_robin | weighted | priority.
 *
 * A seleção é TRANSACIONAL (SELECT ... FOR UPDATE + UPDATE no mesmo client)
 * para que dois cliques simultâneos não escolham incorretamente o mesmo
 * estado da rotação (incrementa total_redirects/last_selected_at atômicamente).
 */

// Escolhe o índice ponderado a partir dos pesos (>=1).
function escolherPonderado(dests) {
  const total = dests.reduce((s, d) => s + Math.max(1, d.weight || 1), 0);
  let r = Math.random() * total;
  for (const d of dests) {
    r -= Math.max(1, d.weight || 1);
    if (r <= 0) return d;
  }
  return dests[dests.length - 1];
}

/**
 * Seleciona um destino ativo da campanha conforme o rotation_mode.
 * Recebe um pool client (transação já aberta). Retorna a linha do destino ou null.
 */
export async function selecionarDestino(client, campaign) {
  // Trava as linhas de destino da campanha para a seleção ser consistente sob concorrência.
  const { rows: dests } = await client.query(
    `SELECT * FROM tracking_destinations
     WHERE campaign_id = $1 AND enabled = true AND whatsapp_number IS NOT NULL AND whatsapp_number <> ''
     ORDER BY position ASC, id ASC
     FOR UPDATE`,
    [campaign.id]
  );
  if (!dests.length) return null;

  const modo = campaign.rotation_mode || 'single';
  let escolhido;

  if (modo === 'single' || dests.length === 1) {
    escolhido = dests[0];
  } else if (modo === 'weighted') {
    escolhido = escolherPonderado(dests);
  } else if (modo === 'priority') {
    // Prioridade fixa: sempre o de menor position habilitado (já ordenado).
    escolhido = dests[0];
  } else {
    // round_robin: o que foi selecionado há mais tempo (NULL primeiro).
    escolhido = [...dests].sort((a, b) => {
      const ta = a.last_selected_at ? new Date(a.last_selected_at).getTime() : 0;
      const tb = b.last_selected_at ? new Date(b.last_selected_at).getTime() : 0;
      return ta - tb;
    })[0];
  }

  // Atualiza contadores do destino escolhido (atômico dentro da transação).
  await client.query(
    `UPDATE tracking_destinations
     SET total_redirects = total_redirects + 1, last_selected_at = NOW()
     WHERE id = $1`,
    [escolhido.id]
  );

  return escolhido;
}
