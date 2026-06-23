// ── Captação e Links Rastreáveis ─────────────────────────────────────────────
// Gerencia campanhas de link rastreável: criação, edição, listagem e métricas.

// ── Estado local ─────────────────────────────────────────────────────────────
let _capCampanhas   = [];   // cache da listagem
let _capEditId      = null; // id da campanha em edição (null = criação)
let _capDestinos    = [];   // destinos no modal (array mutável)
let _capInstancias  = [];   // instâncias Evolution vinculadas ao cliente
let _capArquivarId  = null; // link aguardando confirmação no modal interno
let _capJornadaEtapas = []; // etapas locais; persistidas junto com o link
let _capConceitos = null;   // conceitos Meta aceitos pelo backend
let _capIntEtapas = [];     // jornada geral CTWA do cliente selecionado
let _capIntLoadSeq = 0;     // impede resposta antiga ao trocar de cliente

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
  const global = $('selectClienteAdmin');
  const user = capUsuario();
  const seletores = [
    { box: $('capClienteSelectorBox'), sel: $('capSelectCliente') },
    { box: $('intClienteSelectorBox'), sel: $('intSelectCliente') },
  ];

  seletores.forEach(({ box, sel }) => {
    if (!box || !sel) return;
    if (!user.is_admin || !global) {
      box.style.display = 'none';
      return;
    }
    // Copia as <option> do seletor global e marca o cliente atual.
    sel.innerHTML = global.innerHTML;
    if (clienteAdminSelecionado) sel.value = String(clienteAdminSelecionado);
    box.style.display = 'flex';
    if (window.lucide) lucide.createIcons({ nodes: [box] });
  });
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

/** Monta a URL pública usando o identificador imutável gerado pelo servidor. */
function capLinkUrl(publicId) {
  return `${baseUrl()}/redirect/${publicId}`;
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

function capIntBloquear(bloqueado, mensagem) {
  const blocked = $('capIntBlocked');
  const content = $('capIntContent');
  if (blocked) {
    blocked.style.display = bloqueado ? '' : 'none';
    if (mensagem) blocked.textContent = mensagem;
  }
  if (content) content.style.display = bloqueado ? 'none' : '';
}

function capIntConceitosWpp() {
  return (_capConceitos || []).filter(conceito => conceito.wpp);
}

function capIntPopularSelect() {
  const select = $('capIntConcept');
  if (!select) return;
  select.innerHTML = capIntConceitosWpp()
    .map(conceito => `<option value="${esc(conceito.key)}">${esc(conceito.label)}</option>`)
    .join('');
}

function capIntConceitoLabel(key) {
  return capIntConceitosWpp().find(conceito => conceito.key === key)?.label || key || 'Evento';
}

async function capIntCarregar() {
  capSincronizarSeletorCliente();
  const clienteId = capClienteId();
  const seq = ++_capIntLoadSeq;
  _capIntEtapas = [];
  capIntCancelarForm();
  if ($('capIntTemplate')) $('capIntTemplate').value = '';
  if ($('capIntQualificacao')) $('capIntQualificacao').value = '';

  if (!clienteId) {
    capIntBloquear(true, 'Selecione um cliente para configurar o Rastreamento Inteligente.');
    return;
  }

  capIntBloquear(false);
  if ($('capIntLista')) $('capIntLista').innerHTML = '<div class="cap-journey-empty">Carregando configuração…</div>';

  try {
    const [configResponse, stagesResponse] = await Promise.all([
      authFetch(capUrlApi('/api/journey-stages', { action: 'config' })),
      authFetch(capUrlApi('/api/journey-stages')),
      capCarregarConceitos(),
    ]);
    const config = await readApiJson(configResponse, 'Falha ao carregar a configuração inteligente');
    const stages = await readApiJson(stagesResponse, 'Falha ao carregar as etapas da jornada');
    if (seq !== _capIntLoadSeq || Number(capClienteId()) !== Number(clienteId)) return;

    $('capIntTemplate').value = config.template_venda || '';
    $('capIntQualificacao').value = config.template_qualificacao || '';
    _capIntEtapas = Array.isArray(stages) ? stages : [];
    capIntPopularSelect();
    capIntRender();
  } catch (e) {
    if (seq !== _capIntLoadSeq) return;
    _capIntEtapas = [];
    if ($('capIntLista')) {
      $('capIntLista').innerHTML = `<div class="cap-journey-empty" style="color:var(--red);">Erro: ${esc(e.message)}</div>`;
    }
  }
}

function capIntRender() {
  const lista = $('capIntLista');
  if (!lista) return;
  if (!_capIntEtapas.length) {
    lista.innerHTML = '<div class="cap-journey-empty">Nenhuma etapa configurada. Crie a primeira abaixo.</div>';
    return;
  }

  lista.innerHTML = _capIntEtapas.map((etapa, index) => `
    <div class="cap-journey-stage">
      <span class="cap-journey-order">${index + 1}</span>
      <div class="cap-journey-stage-main">
        <strong>${esc(etapa.name)}${etapa.enabled === false ? ' · inativa' : ''}</strong>
        <small>${esc(capIntConceitoLabel(etapa.event_concept))} · ${esc((etapa.keywords || []).join(', ') || 'sem palavra-chave')}</small>
      </div>
      <div class="cap-journey-actions">
        <button type="button" onclick="capIntMover(${index}, -1)" title="Mover para cima" ${index === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button>
        <button type="button" onclick="capIntMover(${index}, 1)" title="Mover para baixo" ${index === _capIntEtapas.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button>
        <button type="button" onclick="capIntEditar(${Number(etapa.id)})" title="Editar etapa"><i data-lucide="edit-3"></i></button>
        <button type="button" class="danger" onclick="capIntExcluir(${Number(etapa.id)})" title="Excluir etapa"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`).join('');
  if (window.lucide) lucide.createIcons({ nodes: [lista] });
}

function capIntNovaEtapa() {
  capIntPopularSelect();
  $('capIntEtapaId').value = '';
  $('capIntNome').value = '';
  $('capIntConcept').value = capIntConceitosWpp().some(c => c.key === 'qualified')
    ? 'qualified'
    : (capIntConceitosWpp()[0]?.key || '');
  $('capIntKeywords').value = '';
  $('capIntMatch').value = 'partial';
  $('capIntRegex').value = '';
  $('capIntEnabled').checked = true;
  $('capIntSalvarEtapaBtn').textContent = 'Criar etapa';
  $('capIntForm').style.display = '';
  $('capIntNome').focus();
}

function capIntEditar(id) {
  const etapa = _capIntEtapas.find(item => Number(item.id) === Number(id));
  if (!etapa) return;
  capIntPopularSelect();
  $('capIntEtapaId').value = etapa.id;
  $('capIntNome').value = etapa.name || '';
  $('capIntConcept').value = etapa.event_concept || 'lead';
  $('capIntKeywords').value = (etapa.keywords || []).join(', ');
  $('capIntMatch').value = etapa.keyword_match === 'exact' ? 'exact' : 'partial';
  $('capIntRegex').value = etapa.value_regex || '';
  $('capIntEnabled').checked = etapa.enabled !== false;
  $('capIntSalvarEtapaBtn').textContent = 'Salvar etapa';
  $('capIntForm').style.display = '';
  $('capIntNome').focus();
}

function capIntCancelarForm() {
  const form = $('capIntForm');
  if (form) form.style.display = 'none';
}

async function capIntCancelarConfig() {
  capIntCancelarForm();
  await capIntCarregar();
  toast('Alterações não salvas foram descartadas.', 'success');
}

function capIntEtapaPayload(etapa, position) {
  return capBodyCliente({
    id: etapa.id || undefined,
    name: etapa.name,
    event_concept: etapa.event_concept,
    trigger_type: 'keyword',
    keywords: etapa.keywords || [],
    keyword_match: etapa.keyword_match === 'exact' ? 'exact' : 'partial',
    value_regex: etapa.value_regex || null,
    currency: etapa.currency || 'BRL',
    position,
    enabled: etapa.enabled !== false,
  });
}

async function capIntSalvarEtapa() {
  if (!capClienteId()) return toast('Selecione um cliente.', 'error');
  const nome = $('capIntNome')?.value.trim();
  const keywords = ($('capIntKeywords')?.value || '').split(',').map(k => k.trim()).filter(Boolean);
  const valueRegex = $('capIntRegex')?.value.trim() || null;
  if (!nome) return toast('Informe o nome da etapa.', 'error');
  if (!keywords.length) return toast('Informe ao menos uma palavra-chave.', 'error');
  if (valueRegex) {
    try { new RegExp(valueRegex); } catch {
      return toast('A expressão regular de valor é inválida.', 'error');
    }
  }

  const id = Number($('capIntEtapaId')?.value) || null;
  const original = _capIntEtapas.find(item => Number(item.id) === id);
  const etapa = {
    id,
    name: nome,
    event_concept: $('capIntConcept')?.value || 'lead',
    keywords,
    keyword_match: $('capIntMatch')?.value === 'exact' ? 'exact' : 'partial',
    value_regex: valueRegex,
    currency: original?.currency || 'BRL',
    enabled: $('capIntEnabled')?.checked !== false,
  };
  const position = original ? _capIntEtapas.indexOf(original) : _capIntEtapas.length;
  const button = $('capIntSalvarEtapaBtn');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando…';

  try {
    const response = await authFetch('/api/journey-stages', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capIntEtapaPayload(etapa, position)),
    });
    await readApiJson(response, 'Falha ao salvar a etapa');
    toast('Etapa salva.', 'success');
    await capIntCarregar();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function capIntExcluir(id) {
  if (!capClienteId() || !id) return;
  try {
    const response = await authFetch(capUrlApi('/api/journey-stages', { id }), { method: 'DELETE' });
    await readApiJson(response, 'Falha ao excluir a etapa');
    toast('Etapa excluída.', 'success');
    await capIntCarregar();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}

async function capIntMover(index, direction) {
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= _capIntEtapas.length) return;
  const anterior = [..._capIntEtapas];
  [_capIntEtapas[index], _capIntEtapas[destination]] =
    [_capIntEtapas[destination], _capIntEtapas[index]];
  capIntRender();

  try {
    const response = await authFetch('/api/journey-stages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capBodyCliente({
        action: 'reorder',
        stage_ids: _capIntEtapas.map(etapa => etapa.id),
      })),
    });
    await readApiJson(response, 'Falha ao ordenar a jornada');
  } catch (e) {
    _capIntEtapas = anterior;
    capIntRender();
    toast('Erro ao ordenar: ' + e.message, 'error');
  }
}

async function capIntSalvarConfig() {
  if (!capClienteId()) return toast('Selecione um cliente.', 'error');
  const button = $('capIntSalvarConfigBtn');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const response = await authFetch('/api/journey-stages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capBodyCliente({
        action: 'config',
        template_venda: $('capIntTemplate')?.value || '',
        template_qualificacao: $('capIntQualificacao')?.value || '',
      })),
    });
    const config = await readApiJson(response, 'Falha ao salvar a configuração inteligente');
    $('capIntTemplate').value = config.template_venda || '';
    $('capIntQualificacao').value = config.template_qualificacao || '';
    toast('Rastreamento inteligente atualizado.', 'success');
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
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
              <code title="${esc(url)}">/redirect/${esc(c.slug)}</code>
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

// ── Arquivar ───────────────────────────────────────────────────────────────────
function capExcluir(id) {
  const campanha = _capCampanhas.find(c => Number(c.id) === Number(id));
  const nome = campanha?.name || `#${id}`;
  _capArquivarId = Number(id);
  $('capArquivarNome').textContent = `Link: ${nome}`;
  $('modalArquivarLink').classList.add('open');
  lucide.createIcons({ nodes: [$('modalArquivarLink')] });
  setTimeout(() => $('capBtnConfirmarArquivar')?.focus(), 50);
}

function capFecharModalArquivar() {
  $('modalArquivarLink')?.classList.remove('open');
  _capArquivarId = null;
}

async function capConfirmarArquivamento() {
  const id = _capArquivarId;
  if (!id) return capFecharModalArquivar();
  const btn = $('capBtnConfirmarArquivar');
  const original = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Arquivando...';
  }
  try {
    const r = await authFetch(capUrlApi('/api/tracking-campaigns', { id }), { method: 'DELETE' });
    await readApiJson(r, 'Falha ao arquivar link');
    toast('Link arquivado. O histórico foi preservado.', 'success');
    capFecharModalArquivar();
    await carregarCampanhasLink();
  } catch (e) {
    toast('Erro ao arquivar: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
}

// ── Modal Criar / Editar ───────────────────────────────────────────────────────
async function capCarregarConceitos() {
  if (_capConceitos) return _capConceitos;
  const r = await authFetch('/api/journey-stages?meta=concepts');
  const data = await readApiJson(r, 'Falha ao carregar eventos Meta');
  _capConceitos = Array.isArray(data) ? data : [];
  return _capConceitos;
}

function capConceitosWeb() {
  return (_capConceitos || []).filter(conceito => conceito.web);
}

function capConceitoLabel(key) {
  return capConceitosWeb().find(conceito => conceito.key === key)?.label || key || 'Evento';
}

function capPopularEventosJornada() {
  const options = capConceitosWeb()
    .map(conceito => `<option value="${esc(conceito.key)}">${esc(conceito.label)}</option>`)
    .join('');
  const conversion = $('capConversionEvent');
  const stage = $('capJeConcept');
  if (conversion) conversion.innerHTML = options;
  if (stage) stage.innerHTML = options;
}

function capSwitchModalTab(tab) {
  const atual = tab === 'jornada' ? 'jornada' : 'config';
  ['config', 'jornada'].forEach(nome => {
    const panel = $(`capPanel-${nome}`);
    const button = $(`capTab-${nome}`);
    if (panel) panel.style.display = nome === atual ? '' : 'none';
    if (button) button.classList.toggle('active', nome === atual);
  });
  capJornadaCancelarForm();
  if (window.lucide) lucide.createIcons({ nodes: [$('modalCampanha')] });
}

function capToggleConversionAuto() {
  const ativo = $('capConversionAuto')?.checked === true;
  const box = $('capConversionEventBox');
  if (box) box.style.display = ativo ? '' : 'none';
}

function capJornadaRender() {
  const lista = $('capJornadaLista');
  if (!lista) return;
  if (!_capJornadaEtapas.length) {
    lista.innerHTML = '<div class="cap-journey-empty">Nenhuma etapa configurada para este link.</div>';
    return;
  }

  lista.innerHTML = _capJornadaEtapas.map((etapa, index) => {
    const keywords = (etapa.keywords || []).join(', ');
    const inactive = etapa.enabled === false ? ' · inativa' : '';
    return `
      <div class="cap-journey-stage">
        <span class="cap-journey-order">${index + 1}</span>
        <div class="cap-journey-stage-main">
          <strong>${esc(etapa.name)}${inactive}</strong>
          <small>${esc(capConceitoLabel(etapa.event_concept))} · ${esc(keywords || 'sem palavra-chave')}</small>
        </div>
        <div class="cap-journey-actions">
          <button type="button" onclick="capJornadaMover(${index}, -1)" title="Mover para cima" ${index === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button>
          <button type="button" onclick="capJornadaMover(${index}, 1)" title="Mover para baixo" ${index === _capJornadaEtapas.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button>
          <button type="button" onclick="capJornadaEditar(${index})" title="Editar etapa"><i data-lucide="edit-3"></i></button>
          <button type="button" class="danger" onclick="capJornadaExcluir(${index})" title="Excluir etapa"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons({ nodes: [lista] });
}

function capJornadaNovaEtapa() {
  capPopularEventosJornada();
  $('capJeIndex').value = '';
  $('capJeNome').value = '';
  $('capJeConcept').value = capConceitosWeb().some(c => c.key === 'qualified') ? 'qualified' : (capConceitosWeb()[0]?.key || '');
  $('capJeKeywords').value = '';
  $('capJeMatch').value = 'partial';
  $('capJeRegex').value = '';
  $('capJeEnabled').checked = true;
  $('capJeSalvarBtn').textContent = 'Adicionar etapa';
  $('capJornadaForm').style.display = '';
  $('capJeNome').focus();
}

function capJornadaEditar(index) {
  const etapa = _capJornadaEtapas[index];
  if (!etapa) return;
  capPopularEventosJornada();
  $('capJeIndex').value = String(index);
  $('capJeNome').value = etapa.name || '';
  $('capJeConcept').value = etapa.event_concept || 'lead';
  $('capJeKeywords').value = (etapa.keywords || []).join(', ');
  $('capJeMatch').value = etapa.keyword_match === 'exact' ? 'exact' : 'partial';
  $('capJeRegex').value = etapa.value_regex || '';
  $('capJeEnabled').checked = etapa.enabled !== false;
  $('capJeSalvarBtn').textContent = 'Salvar etapa';
  $('capJornadaForm').style.display = '';
  $('capJeNome').focus();
}

function capJornadaCancelarForm() {
  const form = $('capJornadaForm');
  if (form) form.style.display = 'none';
}

function capJornadaSalvarEtapa() {
  const nome = $('capJeNome')?.value.trim();
  const keywords = ($('capJeKeywords')?.value || '').split(',').map(k => k.trim()).filter(Boolean);
  const valueRegex = $('capJeRegex')?.value.trim() || null;
  if (!nome) return toast('Informe o nome da etapa.', 'error');
  if (!keywords.length) return toast('Informe ao menos uma palavra-chave.', 'error');
  if (valueRegex) {
    try { new RegExp(valueRegex); } catch {
      return toast('A expressão regular de valor é inválida.', 'error');
    }
  }

  const indexValue = $('capJeIndex')?.value;
  const index = indexValue === '' ? -1 : Number(indexValue);
  const original = index >= 0 ? _capJornadaEtapas[index] : null;
  const etapa = {
    ...(original?.id ? { id: original.id } : {}),
    name: nome,
    event_concept: $('capJeConcept')?.value || 'lead',
    trigger_type: 'keyword',
    keywords,
    keyword_match: $('capJeMatch')?.value === 'exact' ? 'exact' : 'partial',
    value_regex: valueRegex,
    currency: original?.currency || 'BRL',
    enabled: $('capJeEnabled')?.checked !== false,
  };

  if (index >= 0 && _capJornadaEtapas[index]) _capJornadaEtapas[index] = etapa;
  else _capJornadaEtapas.push(etapa);
  capJornadaCancelarForm();
  capJornadaRender();
}

function capJornadaMover(index, direction) {
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= _capJornadaEtapas.length) return;
  [_capJornadaEtapas[index], _capJornadaEtapas[destination]] =
    [_capJornadaEtapas[destination], _capJornadaEtapas[index]];
  capJornadaCancelarForm();
  capJornadaRender();
}

function capJornadaExcluir(index) {
  if (!_capJornadaEtapas[index]) return;
  _capJornadaEtapas.splice(index, 1);
  capJornadaCancelarForm();
  capJornadaRender();
}

async function abrirModalCampanha(id, duplicar = false) {
  if (!capExigirCliente()) {
    toast('Selecione um cliente antes de criar ou editar um link.', 'error');
    return;
  }
  _capEditId  = duplicar ? null : (id || null);
  _capDestinos = [];
  _capInstancias = [];
  _capJornadaEtapas = [];

  // Reset form
  ['capNome','capMensagem','capUtmSource','capUtmMedium','capUtmCampaign','capUtmContent'].forEach(i => {
    const el = $(i); if (el) el.value = '';
  });
  const modeEl = $('capModo'); if (modeEl) modeEl.value = 'single';
  const origEl = $('capOrigem'); if (origEl) origEl.value = 'bio';
  $('capConversionAuto').checked = false;
  $('capDestinosLista').innerHTML = '';
  capSwitchModalTab('config');
  capJornadaCancelarForm();
  try {
    await capCarregarConceitos();
    capPopularEventosJornada();
    $('capConversionEvent').value = 'lead';
  } catch (e) {
    toast('Erro ao preparar eventos da jornada: ' + e.message, 'error');
    return;
  }
  if (id) {
    // Edição/duplicação: carrega os dados completos da campanha.
    $('capModalTitulo').textContent = duplicar ? 'Duplicar link' : 'Editar link';
    $('btnSalvarCampanha').textContent = duplicar ? 'Criar cópia' : 'Salvar alterações';
    try {
      const r = await authFetch(capUrlApi('/api/tracking-campaigns', { id }));
      const c = await readApiJson(r, 'Falha ao carregar link');
      $('capNome').value      = duplicar ? `Cópia de ${c.name || 'link'}` : (c.name || '');
      modeEl.value            = c.rotation_mode || 'single';
      origEl.value            = c.origin_type   || 'bio';
      $('capMensagem').value  = c.default_message || '';
      capAutoResizeMensagem();
      $('capUtmSource').value   = c.utm_source   || '';
      $('capUtmMedium').value   = c.utm_medium   || '';
      $('capUtmCampaign').value = c.utm_campaign || '';
      $('capUtmContent').value  = c.utm_content  || '';
      $('capConversionAuto').checked = c.conversion_auto === true;
      $('capConversionEvent').value = c.conversion_event || 'lead';
      _capDestinos = (c.destinations || []).map(d => {
        const copia = { ...d };
        if (duplicar) delete copia.id;
        return copia;
      });
      _capJornadaEtapas = (c.journey_stages || []).map(stage => {
        const copia = {
          ...stage,
          keywords: Array.isArray(stage.keywords) ? [...stage.keywords] : [],
        };
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
    capAutoResizeMensagem();
  }

  capToggleConversionAuto();
  capJornadaRender();
  await capCarregarInstancias();
  capRenderDestinos();
  capToggleModo();
  capHintModo(modeEl.value);
  capHintOrigem(origEl.value);
  $('modalCampanha').classList.add('open');
  lucide.createIcons({ nodes: [$('modalCampanha')] });
  requestAnimationFrame(capAutoResizeMensagem);
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
  capAutoResizeMensagem();
}

function capAutoResizeMensagem() {
  const input = $('capMensagem');
  if (!input) return;
  input.style.height = 'auto';
  const altura = Math.min(220, Math.max(48, input.scrollHeight));
  input.style.height = `${altura}px`;
  input.style.overflowY = input.scrollHeight > 220 ? 'auto' : 'hidden';
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
  if (!_capDestinos.length) { toast('Adicione pelo menos um número de destino.', 'error'); return; }
  if (_capDestinos.some(d => !d.instance_name)) { toast('Todos os destinos precisam estar vinculados a uma instância.', 'error'); return; }
  if (!_capDestinos.some(d => d.enabled !== false)) { toast('Mantenha ao menos um destino ativo.', 'error'); return; }
  if (($('capModo')?.value || 'single') === 'single' && _capDestinos.filter(d => d.enabled !== false).length !== 1) {
    toast('No modo destino único, mantenha exatamente um número ativo.', 'error');
    return;
  }

  const body = capBodyCliente({
    name:            nome,
    rotation_mode:   $('capModo')?.value  || 'single',
    origin_type:     $('capOrigem')?.value || 'bio',
    default_message: $('capMensagem')?.value.trim() || null,
    utm_source:      $('capUtmSource')?.value.trim()   || null,
    utm_medium:      $('capUtmMedium')?.value.trim()   || null,
    utm_campaign:    $('capUtmCampaign')?.value.trim() || null,
    utm_content:     $('capUtmContent')?.value.trim()  || null,
    conversion_auto: $('capConversionAuto')?.checked === true,
    conversion_event:$('capConversionEvent')?.value || 'lead',
    destinations:    _capDestinos,
    journey_stages:  _capJornadaEtapas.map((stage, position) => ({ ...stage, position })),
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
