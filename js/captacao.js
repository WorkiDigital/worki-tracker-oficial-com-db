// ── Captação e Links Rastreáveis ─────────────────────────────────────────────
// Gerencia campanhas de link rastreável: criação, edição, listagem e métricas.

// ── Estado local ─────────────────────────────────────────────────────────────
let _capCampanhas   = [];   // cache da listagem
let _capEditId      = null; // id da campanha em edição (null = criação)
let _capDestinos    = [];   // destinos no modal (array mutável)
let _capInstancias  = [];   // instâncias Evolution vinculadas ao cliente

// ── Helpers ──────────────────────────────────────────────────────────────────
const baseUrl = () => window.location.origin;

function capUsuario() {
  try { return JSON.parse(localStorage.getItem('adlytics_user') || '{}'); }
  catch { return {}; }
}

function capClienteId() {
  const user = capUsuario();
  return user.is_admin ? (clienteAdminSelecionado || null) : (user.cliente_id || null);
}

function capClienteNome() {
  const user = capUsuario();
  if (!user.is_admin) return '';
  const select = $('selectClienteAdmin');
  return select?.options?.[select.selectedIndex]?.text || '';
}

// Espelha o seletor global de cliente (das abas Leads) dentro da aba Captação,
// já que #leadsControls não aparece aqui. Só admin vê.
function capSincronizarSeletorCliente() {
  const box = $('capClienteSelectorBox');
  const sel = $('capSelectCliente');
  const global = $('selectClienteAdmin');
  const user = capUsuario();
  if (!box || !sel) return;
  if (!user.is_admin || !global) { box.style.display = 'none'; return; }

  // Copia as <option> do seletor global e marca o cliente atual.
  sel.innerHTML = global.innerHTML;
  if (clienteAdminSelecionado) sel.value = String(clienteAdminSelecionado);
  box.style.display = 'flex';
  if (window.lucide) lucide.createIcons({ nodes: [box] });
}

function capExigirCliente() {
  capSincronizarSeletorCliente();
  const clienteId = capClienteId();
  const aviso = $('capClienteAviso');
  const user = capUsuario();

  if (!clienteId) {
    if (aviso) {
      aviso.style.display = '';
      aviso.style.color = '#f59e0b';
      aviso.style.borderColor = 'rgba(245,158,11,.35)';
      aviso.style.background = 'rgba(245,158,11,.08)';
      aviso.textContent = user.is_admin
        ? 'Selecione um cliente no topo do painel para gerenciar os links rastreáveis.'
        : 'Não foi possível identificar o cliente desta conta.';
    }
    return null;
  }

  if (aviso && user.is_admin) {
    aviso.style.display = '';
    aviso.style.color = 'var(--blue)';
    aviso.style.borderColor = 'rgba(59,130,246,.3)';
    aviso.style.background = 'rgba(59,130,246,.08)';
    aviso.textContent = `Gerenciando links de: ${capClienteNome() || `Cliente #${clienteId}`}`;
  } else if (aviso) {
    aviso.style.display = 'none';
  }
  return clienteId;
}

function capUrlApi(path, params = {}) {
  const clienteId = capClienteId();
  const q = new URLSearchParams(params);
  if (clienteId) q.set('cliente_id', clienteId);
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

function capBodyCliente(body = {}) {
  const clienteId = capClienteId();
  return clienteId ? { ...body, cliente_id: clienteId } : body;
}

/** Monta a URL pública de um slug. */
function capLinkUrl(slug) {
  return `${baseUrl()}/r/${slug}`;
}

/** Copia texto para a área de transferência com feedback de toast. */
async function capCopiar(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || 'Copiado!', 'success');
  } catch {
    toast('Não foi possível copiar automaticamente.', 'error');
  }
}

// ── Carregar Métricas resumo ──────────────────────────────────────────────────
async function carregarMetricasLink() {
  const el = $('capMetricas');
  if (!el) return;
  if (!capExigirCliente()) {
    el.innerHTML = '';
    return;
  }
  try {
    const r = await authFetch(capUrlApi('/api/tracking-metrics'));
    const d = await readApiJson(r, 'Falha ao carregar métricas dos links');
    const t = d.totais || {};
    el.innerHTML = [
      { label: 'Cliques',     val: t.cliques     || 0, icon: 'mouse-pointer-click', cor: 'var(--blue)' },
      { label: 'Conversões',  val: t.conversoes  || 0, icon: 'check-circle',         cor: '#10b981' },
      { label: 'Leads',       val: t.leads       || 0, icon: 'users',                cor: '#8b5cf6' },
      { label: 'Taxa conv.',  val: `${t.taxa_conversao || 0}%`, icon: 'trending-up', cor: '#f59e0b' },
    ].map(m => `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border-radius:9px;background:${m.cor}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i data-lucide="${m.icon}" style="width:16px;color:${m.cor};"></i>
        </div>
        <div>
          <div style="font-size:20px;font-weight:800;color:var(--text);line-height:1;">${esc(String(m.val))}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${m.label}</div>
        </div>
      </div>`).join('');
    lucide.createIcons({ nodes: [el] });
  } catch (e) {
    console.error('[captacao] Falha ao carregar métricas:', e);
    el.innerHTML = '<div style="grid-column:1/-1;padding:12px 14px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);border-radius:10px;color:var(--red);font-size:12px;">Não foi possível carregar as métricas dos links.</div>';
  }
}

// ── Carregar lista de campanhas ───────────────────────────────────────────────
async function carregarCampanhasLink() {
  const lista = $('capListaLinks');
  if (!lista) return;
  if (!capExigirCliente()) {
    lista.innerHTML = '<div style="text-align:center;padding:35px;color:var(--muted);">Selecione um cliente para visualizar os links.</div>';
    $('capMetricas').innerHTML = '';
    return;
  }
  lista.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">Carregando…</div>';

  await carregarMetricasLink();

  try {
    const r = await authFetch(capUrlApi('/api/tracking-campaigns'));
    const data = await readApiJson(r, 'Falha ao carregar campanhas');

    _capCampanhas = data || [];
    if (!_capCampanhas.length) {
      lista.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--muted);">
          <i data-lucide="link-2-off" style="width:32px;height:32px;margin-bottom:12px;opacity:.4;display:block;margin-inline:auto;"></i>
          <p style="margin:0 0 14px;font-size:14px;">Nenhum link rastreável criado ainda.</p>
          <button class="btn btn-primary btn-sm" onclick="abrirModalCampanha()">
            <i data-lucide="plus" style="width:13px;"></i> Criar primeiro link
          </button>
        </div>`;
      lucide.createIcons({ nodes: [lista] });
      return;
    }

    lista.innerHTML = `
      <div class="cap-links-table-wrap">
        <table class="cap-links-table">
          <thead>
            <tr>
              <th>Nome / Link</th>
              <th>Modo</th>
              <th>Cliques</th>
              <th>Conv.</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="capTbody"></tbody>
        </table>
      </div>`;

    const tbody = $('capTbody');
    const MODO_LABEL = { single:'Único', round_robin:'Rotação', weighted:'Ponderado', priority:'Prioridade' };

    tbody.innerHTML = _capCampanhas.map(c => {
      const url = capLinkUrl(c.slug);
      const status = c.enabled !== false;
      const statusBg  = status ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.1)';
      const statusClr = status ? '#10b981' : '#ef4444';
      const statusLbl = status ? '● Ativo' : '● Pausado';
      return `
        <tr>
          <td>
            <div class="cap-link-identity">
              <strong title="${esc(c.name)}">${esc(c.name)}</strong>
              <code title="${esc(url)}">/r/${esc(c.slug)}</code>
              <button class="cap-icon-action" title="Copiar link" onclick="capCopiarLink(${Number(c.id)})">
                <i data-lucide="copy" style="width:11px;"></i>
              </button>
            </div>
          </td>
          <td>
            <span class="cap-mode-badge">${esc(MODO_LABEL[c.rotation_mode] || c.rotation_mode || '—')}</span>
          </td>
          <td class="cap-number-cell">${c.cliques || 0}</td>
          <td class="cap-number-cell" style="color:#10b981;">${c.conversoes || 0}</td>
          <td>
            <span class="cap-status-badge" style="background:${statusBg};color:${statusClr};">${statusLbl}</span>
          </td>
          <td>
            <div class="cap-row-actions">
              <button class="cap-icon-action" onclick="capAlternarStatus(${c.id}, ${!status})" title="${status ? 'Pausar' : 'Ativar'}">
                <i data-lucide="${status ? 'pause' : 'play'}"></i>
              </button>
              <button class="cap-icon-action" onclick="abrirModalCampanha(${c.id})" title="Editar">
                <i data-lucide="edit-3"></i>
              </button>
              <button class="cap-icon-action" onclick="capDuplicar(${c.id})" title="Duplicar link">
                <i data-lucide="copy-plus"></i>
              </button>
              <button class="cap-icon-action cap-icon-danger" onclick="capExcluir(${Number(c.id)})" title="Arquivar">
                <i data-lucide="archive"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Varre o documento inteiro (sem `nodes`): a forma com nodes:[lista] às vezes
    // não desce nos <i> aninhados em <tr><td><div>, deixando o ícone como um
    // quadradinho vazio. createIcons() global é o padrão usado no resto do app.
    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (e) {
    lista.innerHTML = `<div style="color:var(--red);padding:20px;text-align:center;">Erro ao carregar: ${esc(e.message)}</div>`;
    toast('Falha ao carregar campanhas: ' + e.message, 'error');
  }
}

function capCopiarLink(id) {
  const campanha = _capCampanhas.find(c => Number(c.id) === Number(id));
  if (!campanha) return toast('Link não encontrado.', 'error');
  capCopiar(capLinkUrl(campanha.slug), 'Link copiado!');
}

function capSlugDuplicado(slugOriginal) {
  const base = capNormalizarSlug(`${slugOriginal || 'link'}-copia`);
  const slugsEmUso = new Set(_capCampanhas.map(c => String(c.slug || '').toLowerCase()));
  if (!slugsEmUso.has(base)) return base;

  let numero = 2;
  while (slugsEmUso.has(`${base}-${numero}`)) numero++;
  return `${base}-${numero}`;
}

function capDuplicar(id) {
  abrirModalCampanha(id, true);
}

// ── Ativar / Pausar ────────────────────────────────────────────────────────────
async function capAlternarStatus(id, enabled) {
  try {
    const r = await authFetch('/api/tracking-campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capBodyCliente({ id, enabled })),
    });
    await readApiJson(r, 'Falha ao alterar status do link');
    toast(enabled ? 'Link ativado.' : 'Link pausado.', 'success');
    carregarCampanhasLink();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}

// ── Excluir ────────────────────────────────────────────────────────────────────
async function capExcluir(id) {
  const campanha = _capCampanhas.find(c => Number(c.id) === Number(id));
  const nome = campanha?.name || `#${id}`;
  if (!confirm(`Arquivar o link "${nome}"?\n\nO link será desativado e removido da lista, mas cliques, conversões e atribuições serão preservados.`)) return;
  try {
    const r = await authFetch(capUrlApi('/api/tracking-campaigns', { id }), { method: 'DELETE' });
    await readApiJson(r, 'Falha ao arquivar link');
    toast('Link arquivado. O histórico foi preservado.', 'success');
    carregarCampanhasLink();
  } catch (e) {
    toast('Erro ao arquivar: ' + e.message, 'error');
  }
}

// ── Modal Criar / Editar ───────────────────────────────────────────────────────
async function abrirModalCampanha(id, duplicar = false) {
  if (!capExigirCliente()) {
    toast('Selecione um cliente antes de criar ou editar um link.', 'error');
    return;
  }
  _capEditId  = duplicar ? null : (id || null);
  _capDestinos = [];
  _capInstancias = [];

  // Reset form
  ['capNome','capSlug','capMensagem','capUtmSource','capUtmMedium','capUtmCampaign','capUtmContent'].forEach(i => {
    const el = $(i); if (el) el.value = '';
  });
  const modeEl = $('capModo'); if (modeEl) modeEl.value = 'single';
  const origEl = $('capOrigem'); if (origEl) origEl.value = 'bio';
  $('capDestinosLista').innerHTML = '';
  capAtualizarSlugHint('');

  if (id) {
    // Edição/duplicação: carrega os dados completos da campanha.
    $('capModalTitulo').textContent = duplicar ? 'Duplicar link' : 'Editar link';
    $('btnSalvarCampanha').textContent = duplicar ? 'Criar cópia' : 'Salvar alterações';
    try {
      const r = await authFetch(capUrlApi('/api/tracking-campaigns', { id }));
      const c = await readApiJson(r, 'Falha ao carregar link');
      $('capNome').value      = duplicar ? `Cópia de ${c.name || 'link'}` : (c.name || '');
      $('capSlug').value      = duplicar ? capSlugDuplicado(c.slug) : (c.slug || '');
      modeEl.value            = c.rotation_mode || 'single';
      origEl.value            = c.origin_type   || 'bio';
      $('capMensagem').value  = c.default_message || '';
      $('capUtmSource').value   = c.utm_source   || '';
      $('capUtmMedium').value   = c.utm_medium   || '';
      $('capUtmCampaign').value = c.utm_campaign || '';
      $('capUtmContent').value  = c.utm_content  || '';
      capAtualizarSlugHint($('capSlug').value);
      _capDestinos = (c.destinations || []).map(d => {
        const copia = { ...d };
        if (duplicar) delete copia.id;
        return copia;
      });
    } catch (e) {
      toast('Erro ao carregar campanha: ' + e.message, 'error');
      return;
    }
  } else {
    $('capModalTitulo').textContent = 'Novo link rastreável';
    $('btnSalvarCampanha').textContent = 'Criar link';
  }

  await capCarregarInstancias();
  capRenderDestinos();
  capToggleModo();
  capHintModo(modeEl.value);
  capHintOrigem(origEl.value);
  $('modalCampanha').classList.add('open');
  lucide.createIcons({ nodes: [$('modalCampanha')] });
  $('capNome').focus();
}

function fecharModalCampanha() {
  $('modalCampanha').classList.remove('open');
}

function capInserirVariavelMensagem(variavel) {
  const input = $('capMensagem');
  if (!input) return;
  const inicio = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const fim = Number.isInteger(input.selectionEnd) ? input.selectionEnd : inicio;
  const antes = input.value.slice(0, inicio);
  const depois = input.value.slice(fim);
  const separadorAntes = antes && !/\s$/.test(antes) ? ' ' : '';
  const separadorDepois = depois && !/^\s|^[,.!?;:]/.test(depois) ? ' ' : '';
  input.value = `${antes}${separadorAntes}${variavel}${separadorDepois}${depois}`.slice(0, 1000);
  const cursor = Math.min(1000, antes.length + separadorAntes.length + variavel.length);
  input.focus();
  input.setSelectionRange(cursor, cursor);
}

// Auto-gera slug a partir do nome
function capAutoSlug() {
  const nomeEl = $('capNome');
  const slugEl = $('capSlug');
  if (!nomeEl || !slugEl) return;
  if (!_capEditId) {
    // Só auto-gera se em criação
    const slug = capNormalizarSlug(nomeEl.value);
    slugEl.value = slug;
    capAtualizarSlugHint(slug);
  }
}

function capNormalizarSlug(valor) {
  return String(valor || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function capAtualizarSlugHint(slug) {
  const slugNormalizado = capNormalizarSlug(slug);
  const input = $('capSlug');
  if (input && input.value !== slugNormalizado) input.value = slugNormalizado;
  const el = $('capSlugHint');
  if (!el) return;
  if (slugNormalizado) {
    el.textContent = `URL: ${baseUrl()}/r/${slugNormalizado}`;
    el.style.color = 'var(--blue)';
  } else {
    el.textContent = 'Gerado automaticamente a partir do nome.';
    el.style.color = 'var(--muted)';
  }
}

function capToggleModo() {
  const modo = $('capModo')?.value;
  const pesoTh = $('capPesoTh');
  if (pesoTh) pesoTh.style.display = modo === 'weighted' ? '' : 'none';
  // Mostra/oculta coluna peso em cada linha
  document.querySelectorAll('.cap-peso-cel').forEach(el => {
    el.style.display = modo === 'weighted' ? '' : 'none';
  });
}

// Hint explicativo do modo de distribuição.
function capHintModo(modo) {
  const el = $('capHintModo');
  if (!el) return;
  const hints = {
    single:      'Cada clique vai para o único número ativo.',
    round_robin: 'Distribui os cliques igualmente entre os números, em rodízio.',
    weighted:    'Distribui por peso: número com peso 2 recebe o dobro de um com peso 1.',
    priority:    'Sempre envia para o primeiro número ativo da lista (os demais são reserva).',
  };
  el.textContent = hints[modo] || hints.single;
}

// Hint explicativo do tipo de origem.
function capHintOrigem(tipo) {
  const el = $('capHintOrigem');
  if (!el) return;
  const hints = {
    bio:      'Para o link fixo da bio do Instagram/perfil. Lead aparece como "Link da bio".',
    campaign: 'Para uma campanha específica com UTMs. Lead aparece como "Link campanha".',
    rotator:  'Para distribuir atendimento entre vários comerciais. Lead aparece como "Rotador".',
  };
  el.textContent = hints[tipo] || 'Apenas classifica a origem do lead (badge no painel).';
}

// ── Destinos no Modal ──────────────────────────────────────────────────────────
async function capCarregarInstancias() {
  const select = $('capNovaInstancia');
  if (!select) return;
  select.disabled = true;
  select.innerHTML = '<option value="">Carregando instâncias…</option>';
  try {
    const clienteId = capClienteId();
    const params = capUsuario().is_admin && clienteId ? { target_cliente_id: clienteId } : {};
    const r = await authFetch(capUrlApi('/api/evo-manager', { action: 'list', ...params }));
    _capInstancias = await readApiJson(r, 'Falha ao carregar instâncias');
    _capInstancias = (_capInstancias || []).filter(i => i.fullName);
    select.innerHTML = '<option value="">Selecione a instância</option>' + _capInstancias.map(i => {
      const estado = i.state === 'open' ? 'conectada' : (i.state || 'desconhecida');
      const numero = i.whatsapp_number ? ` — ${i.whatsapp_number}` : '';
      return `<option value="${esc(i.fullName)}">${esc(i.displayName || i.fullName)}${numero} (${esc(estado)})</option>`;
    }).join('');
    if (!_capInstancias.length) {
      select.innerHTML = '<option value="">Nenhuma instância vinculada</option>';
    }
  } catch (e) {
    select.innerHTML = '<option value="">Erro ao carregar instâncias</option>';
    toast('Erro ao carregar instâncias: ' + e.message, 'error');
  } finally {
    select.disabled = false;
  }
}

function capSelecionarInstancia() {
  const nome = $('capNovaInstancia')?.value || '';
  const instancia = _capInstancias.find(i => i.fullName === nome);
  const numEl = $('capNovoNumero');
  if (!numEl) return;
  // Número é read-only e vem SEMPRE da instância selecionada.
  numEl.value = instancia?.whatsapp_number || '';
}

function capOpcoesInstancia(selecionada) {
  const atualExiste = selecionada && _capInstancias.some(i => i.fullName === selecionada);
  const pendente = selecionada && !atualExiste
    ? `<option value="${esc(selecionada)}" selected>${esc(selecionada)} (não encontrada)</option>`
    : '<option value="">Selecione…</option>';
  return pendente + _capInstancias.map(i => {
    const selected = i.fullName === selecionada ? ' selected' : '';
    const estado = i.state === 'open' ? 'conectada' : (i.state || 'desconhecida');
    return `<option value="${esc(i.fullName)}"${selected}>${esc(i.displayName || i.fullName)} (${esc(estado)})</option>`;
  }).join('');
}

function capVincularDestino(idx, instanceName) {
  const destino = _capDestinos[idx];
  if (!destino) return;
  if (instanceName && _capDestinos.some((d, i) => i !== idx && d.instance_name === instanceName)) {
    toast('Esta instância já está vinculada a outro destino.', 'error');
    capRenderDestinos();
    return;
  }
  destino.instance_name = instanceName || null;
  const instancia = _capInstancias.find(i => i.fullName === instanceName);
  if (instancia?.whatsapp_number) destino.whatsapp_number = instancia.whatsapp_number;
  capRenderDestinos();
  capToggleModo();
}

function capRenderDestinos() {
  const lista = $('capDestinosLista');
  if (!lista) return;
  const modo = $('capModo')?.value || 'single';
  const count = $('capDestinoCount');
  if (count) count.textContent = `${_capDestinos.length} destino${_capDestinos.length === 1 ? '' : 's'}`;

  if (!_capDestinos.length) {
    lista.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Nenhum número adicionado.</div>';
    return;
  }

  lista.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">
          <th style="padding:6px 8px;text-align:left;">Número</th>
          <th style="padding:6px 8px;text-align:left;">Instância</th>
          <th style="padding:6px 8px;text-align:left;">Nome</th>
          <th id="capPesoTh" style="padding:6px 8px;text-align:center;display:${modo === 'weighted' ? '' : 'none'};">Peso</th>
          <th style="padding:6px 8px;text-align:center;">Ativo</th>
          <th style="padding:6px 8px;"></th>
        </tr>
      </thead>
      <tbody>
        ${_capDestinos.map((d, i) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 8px;font-family:monospace;font-size:12px;">${esc(d.whatsapp_number || '')}</td>
            <td style="padding:6px 8px;min-width:180px;">
              <select class="form-control" onchange="capVincularDestino(${i}, this.value)"
                style="min-width:170px;padding:6px 8px;font-size:11px;border-color:${d.instance_name ? 'var(--border)' : 'var(--red)'};">
                ${capOpcoesInstancia(d.instance_name)}
              </select>
            </td>
            <td style="padding:6px 8px;color:var(--muted);">${esc(d.name || '—')}</td>
            <td class="cap-peso-cel" style="padding:6px 8px;text-align:center;display:${modo === 'weighted' ? '' : 'none'};">
              <input type="number" min="1" max="100" value="${d.weight || 1}"
                onchange="_capDestinos[${i}].weight = parseInt(this.value)||1"
                style="width:50px;text-align:center;background:var(--tag);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:2px 4px;font-size:12px;">
            </td>
            <td style="padding:6px 8px;text-align:center;">
              <input type="checkbox" ${d.enabled !== false ? 'checked' : ''}
                onchange="_capDestinos[${i}].enabled = this.checked"
                style="accent-color:var(--blue);">
            </td>
            <td style="padding:6px 8px;text-align:right;">
              <button class="btn btn-ghost btn-sm" onclick="capRemoverDestino(${i})" style="padding:3px 7px;color:var(--red);">
                <i data-lucide="x" style="width:11px;"></i>
              </button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  lucide.createIcons({ nodes: [lista] });
}

function capAdicionarDestino() {
  const instanciaEl = $('capNovaInstancia');
  const numEl = $('capNovoNumero');
  const nomeEl = $('capNovoNome');
  const instance_name = instanciaEl?.value || '';
  if (!instance_name) {
    toast('Selecione a instância vinculada a este número.', 'error');
    return;
  }
  // Número vem SEMPRE da instância (campo read-only), não do que foi digitado.
  const instancia = _capInstancias.find(i => i.fullName === instance_name);
  const numero = (instancia?.whatsapp_number || '').replace(/\D/g, '').trim();
  if (numero.length < 8 || numero.length > 15) {
    toast('Esta instância não tem um número de WhatsApp conectado. Conecte-a antes de usá-la como destino.', 'error');
    return;
  }
  if (_capDestinos.some(d => String(d.whatsapp_number) === numero)) {
    toast('Este número já foi adicionado.', 'error');
    return;
  }
  if (_capDestinos.some(d => d.instance_name === instance_name)) {
    toast('Esta instância já foi adicionada.', 'error');
    return;
  }

  _capDestinos.push({
    whatsapp_number: numero,
    instance_name,
    name: nomeEl?.value.trim() || null,
    weight: 1,
    enabled: true,
  });

  if (numEl)  numEl.value  = '';
  if (nomeEl) nomeEl.value = '';
  if (instanciaEl) instanciaEl.value = '';
  capRenderDestinos();
  capToggleModo();
  lucide.createIcons({ nodes: [$('modalCampanha')] });
}

function capRemoverDestino(idx) {
  _capDestinos.splice(idx, 1);
  capRenderDestinos();
  capToggleModo();
}

// ── Salvar campanha ────────────────────────────────────────────────────────────
async function salvarCampanha() {
  const nome = $('capNome')?.value.trim();
  if (!nome) { toast('Nome é obrigatório.', 'error'); return; }
  const slug = capNormalizarSlug($('capSlug')?.value);
  if (!slug) { toast('O identificador da URL é obrigatório.', 'error'); return; }
  if (!_capDestinos.length) { toast('Adicione pelo menos um número de destino.', 'error'); return; }
  if (_capDestinos.some(d => !d.instance_name)) { toast('Todos os destinos precisam estar vinculados a uma instância.', 'error'); return; }
  if (!_capDestinos.some(d => d.enabled !== false)) { toast('Mantenha ao menos um destino ativo.', 'error'); return; }
  if (($('capModo')?.value || 'single') === 'single' && _capDestinos.filter(d => d.enabled !== false).length !== 1) {
    toast('No modo destino único, mantenha exatamente um número ativo.', 'error');
    return;
  }

  const body = capBodyCliente({
    name:            nome,
    slug,
    rotation_mode:   $('capModo')?.value  || 'single',
    origin_type:     $('capOrigem')?.value || 'bio',
    default_message: $('capMensagem')?.value.trim() || null,
    utm_source:      $('capUtmSource')?.value.trim()   || null,
    utm_medium:      $('capUtmMedium')?.value.trim()   || null,
    utm_campaign:    $('capUtmCampaign')?.value.trim() || null,
    utm_content:     $('capUtmContent')?.value.trim()  || null,
    destinations:    _capDestinos,
  });

  const btn = $('btnSalvarCampanha');
  const orig = btn.textContent;
  btn.textContent = 'Salvando…'; btn.disabled = true;

  try {
    const isEdit = !!_capEditId;
    if (isEdit) body.id = _capEditId;

    const r = await authFetch('/api/tracking-campaigns', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await readApiJson(r, 'Falha ao salvar link');

    toast(isEdit ? 'Link atualizado!' : 'Link criado!', 'success');
    fecharModalCampanha();
    carregarCampanhasLink();

  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  } finally {
    btn.textContent = orig; btn.disabled = false;
  }
}
