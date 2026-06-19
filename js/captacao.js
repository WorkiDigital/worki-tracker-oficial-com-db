// ── Captação e Links Rastreáveis ─────────────────────────────────────────────
// Gerencia campanhas de link rastreável: criação, edição, listagem e métricas.

// ── Estado local ─────────────────────────────────────────────────────────────
let _capCampanhas   = [];   // cache da listagem
let _capEditId      = null; // id da campanha em edição (null = criação)
let _capDestinos    = [];   // destinos no modal (array mutável)

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

function capExigirCliente() {
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
  } catch { /* silencioso */ }
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
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">
              <th style="padding:8px 12px;text-align:left;">Nome / Link</th>
              <th style="padding:8px 12px;text-align:center;">Modo</th>
              <th style="padding:8px 12px;text-align:center;">Cliques</th>
              <th style="padding:8px 12px;text-align:center;">Conv.</th>
              <th style="padding:8px 12px;text-align:center;">Status</th>
              <th style="padding:8px 12px;text-align:right;">Ações</th>
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
        <tr style="border-bottom:1px solid var(--border);transition:background .12s;" onmouseover="this.style.background='var(--tag)'" onmouseout="this.style.background=''">
          <td style="padding:12px 12px;max-width:280px;">
            <div style="font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(c.name)}">${esc(c.name)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
              <code style="font-size:11px;color:var(--muted);background:var(--tag);padding:2px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;" title="${esc(url)}">/r/${esc(c.slug)}</code>
              <button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:10px;" onclick="capCopiarLink(${Number(c.id)})">
                <i data-lucide="copy" style="width:11px;"></i>
              </button>
            </div>
          </td>
          <td style="padding:12px;text-align:center;">
            <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(59,130,246,.12);color:var(--blue);">${esc(MODO_LABEL[c.rotation_mode] || c.rotation_mode || '—')}</span>
          </td>
          <td style="padding:12px;text-align:center;font-weight:700;">${c.cliques || 0}</td>
          <td style="padding:12px;text-align:center;font-weight:700;color:#10b981;">${c.conversoes || 0}</td>
          <td style="padding:12px;text-align:center;">
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:${statusBg};color:${statusClr};">${statusLbl}</span>
          </td>
          <td style="padding:12px;text-align:right;white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" onclick="capAlternarStatus(${c.id}, ${!status})" title="${status ? 'Pausar' : 'Ativar'}" style="padding:4px 8px;">
              <i data-lucide="${status ? 'pause' : 'play'}" style="width:13px;"></i>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="abrirModalCampanha(${c.id})" style="padding:4px 8px;">
              <i data-lucide="edit-3" style="width:13px;"></i>
            </button>
            <button class="btn btn-ghost btn-sm" onclick="capExcluir(${Number(c.id)})" style="padding:4px 8px;color:var(--red);">
              <i data-lucide="trash-2" style="width:13px;"></i>
            </button>
          </td>
        </tr>`;
    }).join('');

    lucide.createIcons({ nodes: [lista] });

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
  if (!confirm(`Excluir permanentemente o link "${nome}"?\n\nTodos os cliques e dados serão apagados.`)) return;
  try {
    const r = await authFetch(capUrlApi('/api/tracking-campaigns', { id }), { method: 'DELETE' });
    await readApiJson(r, 'Falha ao excluir link');
    toast('Link excluído.', 'success');
    carregarCampanhasLink();
  } catch (e) {
    toast('Erro ao excluir: ' + e.message, 'error');
  }
}

// ── Modal Criar / Editar ───────────────────────────────────────────────────────
async function abrirModalCampanha(id) {
  if (!capExigirCliente()) {
    toast('Selecione um cliente antes de criar ou editar um link.', 'error');
    return;
  }
  _capEditId  = id || null;
  _capDestinos = [];

  // Reset form
  ['capNome','capSlug','capMensagem','capUtmSource','capUtmMedium','capUtmCampaign'].forEach(i => {
    const el = $(i); if (el) el.value = '';
  });
  const modeEl = $('capModo'); if (modeEl) modeEl.value = 'single';
  const origEl = $('capOrigem'); if (origEl) origEl.value = 'bio';
  $('capDestinosLista').innerHTML = '';
  capAtualizarSlugHint('');

  if (id) {
    // Edição: carrega dados da campanha
    $('capModalTitulo').textContent = 'Editar link';
    $('btnSalvarCampanha').textContent = 'Salvar alterações';
    try {
      const r = await authFetch(capUrlApi('/api/tracking-campaigns', { id }));
      const c = await readApiJson(r, 'Falha ao carregar link');
      $('capNome').value      = c.name || '';
      $('capSlug').value      = c.slug || '';
      modeEl.value            = c.rotation_mode || 'single';
      origEl.value            = c.origin_type   || 'bio';
      $('capMensagem').value  = c.default_message || '';
      $('capUtmSource').value   = c.utm_source   || '';
      $('capUtmMedium').value   = c.utm_medium   || '';
      $('capUtmCampaign').value = c.utm_campaign || '';
      capAtualizarSlugHint(c.slug);
      _capDestinos = (c.destinations || []).map(d => ({ ...d }));
    } catch (e) {
      toast('Erro ao carregar campanha: ' + e.message, 'error');
      return;
    }
  } else {
    $('capModalTitulo').textContent = 'Novo link rastreável';
    $('btnSalvarCampanha').textContent = 'Criar link';
  }

  capRenderDestinos();
  capToggleModo();
  $('modalCampanha').classList.add('open');
  lucide.createIcons({ nodes: [$('modalCampanha')] });
  $('capNome').focus();
}

function fecharModalCampanha() {
  $('modalCampanha').classList.remove('open');
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

// ── Destinos no Modal ──────────────────────────────────────────────────────────
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
  const numEl = $('capNovoNumero');
  const nomeEl = $('capNovoNome');
  const numero = (numEl?.value || '').replace(/\D/g, '').trim();
  if (numero.length < 8 || numero.length > 15) {
    toast('Informe o número com país e DDD, usando de 8 a 15 dígitos.', 'error');
    return;
  }
  if (_capDestinos.some(d => String(d.whatsapp_number) === numero)) {
    toast('Este número já foi adicionado.', 'error');
    return;
  }

  _capDestinos.push({
    whatsapp_number: numero,
    name: nomeEl?.value.trim() || null,
    weight: 1,
    enabled: true,
  });

  if (numEl)  numEl.value  = '';
  if (nomeEl) nomeEl.value = '';
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
