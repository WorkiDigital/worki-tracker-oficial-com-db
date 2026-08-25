// Calendário de seleção de intervalo (estilo Meta Ads): um único calendário
// visual onde o 1º clique define a data de início e o 2º clique define a
// data de fim, com o intervalo destacado. Substitui a UI dos pares de
// <input type="date"> nativos (que abrem dois calendários separados do
// navegador) sem exigir mudança em nenhum código consumidor — os inputs
// originais continuam existindo no DOM (escondidos) como fonte de verdade;
// tudo que já lê $('dataInicio').value etc. continua funcionando igual.
//
// Uso: initDateRangePicker({ inputStart: 'dataInicio', inputEnd: 'dataFim',
//   trigger: 'dataRangeTrigger', onApply: () => aplicarPeriodoPersonalizado() })
//
// onApply roda quando o usuário fecha o popover com um intervalo completo
// selecionado (2º clique) — o código consumidor decide o que fazer (recarregar
// dados, etc.), igual já fazia antes com o evento 'change' dos inputs nativos.

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA_PT = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

function drpFmtISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function drpParseISO(value) {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
}

function drpFmtBR(date) {
    if (!date) return '';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function drpSameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Cria o popover de calendário (1 instância reaproveitada por picker, criada sob demanda).
function drpBuildPopover(state, elements) {
    const pop = document.createElement('div');
    pop.className = 'drp-popover';
    pop.innerHTML = `
        <div class="drp-header">
            <button type="button" class="drp-nav" data-drp-prev title="Mês anterior">
                <i data-lucide="chevron-left" style="width:16px;"></i>
            </button>
            <div class="drp-header-selects">
                <button type="button" class="drp-month-btn" data-drp-month></button>
                <button type="button" class="drp-year-btn" data-drp-year></button>
            </div>
            <button type="button" class="drp-nav" data-drp-next title="Próximo mês">
                <i data-lucide="chevron-right" style="width:16px;"></i>
            </button>
        </div>
        <div class="drp-weekdays">${DIAS_SEMANA_PT.map(d => `<span>${d}</span>`).join('')}</div>
        <div class="drp-grid" data-drp-grid></div>
        <div class="drp-footer">
            <span class="drp-range-label" data-drp-range-label>Selecione a data de início</span>
            <div class="drp-footer-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-drp-cancel>Cancelar</button>
                <button type="button" class="btn btn-primary btn-sm" data-drp-apply disabled>Aplicar</button>
            </div>
        </div>
    `;
    document.body.appendChild(pop);

    function render() {
        pop.querySelector('[data-drp-month]').textContent = MESES_PT[state.viewMonth] + ' ';
        pop.querySelector('[data-drp-year]').textContent = state.viewYear;

        const grid = pop.querySelector('[data-drp-grid]');
        const firstOfMonth = new Date(state.viewYear, state.viewMonth, 1);
        // getDay(): 0=Dom..6=Sáb → converte pra semana começando na Segunda (Meta usa Seg-Dom)
        const startOffset = (firstOfMonth.getDay() + 6) % 7;
        const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
        const today = new Date(); today.setHours(0,0,0,0);

        let html = '';
        for (let i = 0; i < startOffset; i++) html += '<span class="drp-day drp-day-empty"></span>';
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(state.viewYear, state.viewMonth, day);
            const iso = drpFmtISO(d);
            const isStart = state.start && drpSameDay(d, state.start);
            const isEnd = state.end && drpSameDay(d, state.end);
            const inRange = state.start && state.end && d > state.start && d < state.end;
            const isToday = drpSameDay(d, today);
            const cls = ['drp-day'];
            if (isStart || isEnd) cls.push('drp-day-selected');
            if (inRange) cls.push('drp-day-inrange');
            if (isStart && state.end) cls.push('drp-day-range-start');
            if (isEnd && state.start) cls.push('drp-day-range-end');
            if (isToday) cls.push('drp-day-today');
            html += `<button type="button" class="${cls.join(' ')}" data-drp-date="${iso}">${day}</button>`;
        }
        grid.innerHTML = html;

        const label = pop.querySelector('[data-drp-range-label]');
        const applyBtn = pop.querySelector('[data-drp-apply]');
        if (state.start && state.end) {
            label.textContent = `${drpFmtBR(state.start)} → ${drpFmtBR(state.end)}`;
            applyBtn.disabled = false;
        } else if (state.start) {
            label.textContent = `${drpFmtBR(state.start)} → selecione a data de fim`;
            applyBtn.disabled = true;
        } else {
            label.textContent = 'Selecione a data de início';
            applyBtn.disabled = true;
        }

        if (window.lucide) lucide.createIcons({ nodes: [pop] });
    }

    pop.addEventListener('click', (e) => {
        const dayBtn = e.target.closest('[data-drp-date]');
        if (dayBtn) {
            const clicked = drpParseISO(dayBtn.dataset.drpDate);
            if (!state.start || (state.start && state.end)) {
                // Começa uma seleção nova
                state.start = clicked;
                state.end = null;
            } else if (clicked < state.start) {
                // Clicou antes do início já marcado — vira o novo início
                state.start = clicked;
                state.end = null;
            } else {
                state.end = clicked;
            }
            render();
            return;
        }
        if (e.target.closest('[data-drp-prev]')) {
            state.viewMonth--; if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
            render();
            return;
        }
        if (e.target.closest('[data-drp-next]')) {
            state.viewMonth++; if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
            render();
            return;
        }
        if (e.target.closest('[data-drp-cancel]')) {
            drpClose(state, elements, pop);
            return;
        }
        if (e.target.closest('[data-drp-apply]')) {
            if (state.start && state.end) {
                elements.inputStart.value = drpFmtISO(state.start);
                elements.inputEnd.value = drpFmtISO(state.end);
                drpUpdateTriggerLabel(elements, state);
                drpClose(state, elements, pop);
                if (typeof state.onApply === 'function') state.onApply();
            }
            return;
        }
    });

    state._render = render;
    return pop;
}

function drpUpdateTriggerLabel(elements, state) {
    if (!elements.trigger) return;
    const label = elements.trigger.querySelector('[data-drp-trigger-label]') || elements.trigger;
    if (state.start && state.end) {
        label.textContent = `${drpFmtBR(state.start)} → ${drpFmtBR(state.end)}`;
    } else {
        label.textContent = elements.placeholder || 'Selecionar período';
    }
}

function drpClose(state, elements, pop) {
    pop.classList.remove('drp-open');
    document.removeEventListener('mousedown', state._outsideHandler, true);
}

function drpPositionPopover(pop, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = rect.bottom + 6 + window.scrollY;
    let left = rect.left + window.scrollX;
    // Não deixa o popover sair pela direita da tela
    if (left + popRect.width > window.innerWidth - 12) {
        left = window.innerWidth - popRect.width - 12;
    }
    if (left < 12) left = 12;
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
}

/**
 * Inicializa o range picker num par de <input type="date"> existente.
 * @param {object} opts
 * @param {string} opts.inputStart - id do input de data de início (mantido oculto, fonte de verdade)
 * @param {string} opts.inputEnd   - id do input de data de fim (mantido oculto, fonte de verdade)
 * @param {string} opts.trigger    - id do elemento clicável que abre o calendário
 * @param {string} [opts.placeholder] - texto do trigger quando não há intervalo selecionado
 * @param {function} [opts.onApply] - chamado quando o usuário confirma um intervalo completo
 */
function initDateRangePicker(opts) {
    const inputStart = document.getElementById(opts.inputStart);
    const inputEnd = document.getElementById(opts.inputEnd);
    const trigger = document.getElementById(opts.trigger);
    if (!inputStart || !inputEnd || !trigger) {
        console.warn('[date-range-picker] elementos não encontrados:', opts);
        return null;
    }

    // Os inputs nativos continuam existindo (fonte de verdade lida pelo resto
    // do sistema) mas não devem mais abrir o seletor nativo do navegador.
    inputStart.style.position = 'absolute';
    inputStart.style.width = '1px';
    inputStart.style.height = '1px';
    inputStart.style.opacity = '0';
    inputStart.style.pointerEvents = 'none';
    inputEnd.style.position = 'absolute';
    inputEnd.style.width = '1px';
    inputEnd.style.height = '1px';
    inputEnd.style.opacity = '0';
    inputEnd.style.pointerEvents = 'none';

    const elements = { inputStart, inputEnd, trigger, placeholder: opts.placeholder };
    const today = new Date();
    const state = {
        start: drpParseISO(inputStart.value),
        end: drpParseISO(inputEnd.value),
        viewMonth: today.getMonth(),
        viewYear: today.getFullYear(),
        onApply: opts.onApply,
    };
    if (state.start) { state.viewMonth = state.start.getMonth(); state.viewYear = state.start.getFullYear(); }

    let pop = null;

    drpUpdateTriggerLabel(elements, state);

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!pop) pop = drpBuildPopover(state, elements);
        // Sincroniza com o valor atual dos inputs (pode ter mudado por outro
        // meio, ex: onPeriodoChange resetando o campo).
        state.start = drpParseISO(inputStart.value);
        state.end = drpParseISO(inputEnd.value);
        if (state.start) { state.viewMonth = state.start.getMonth(); state.viewYear = state.start.getFullYear(); }
        state._render();
        pop.classList.add('drp-open');
        drpPositionPopover(pop, trigger);

        state._outsideHandler = (evt) => {
            if (!pop.contains(evt.target) && !trigger.contains(evt.target)) {
                drpClose(state, elements, pop);
            }
        };
        document.addEventListener('mousedown', state._outsideHandler, true);
    });

    return {
        refresh() {
            state.start = drpParseISO(inputStart.value);
            state.end = drpParseISO(inputEnd.value);
            drpUpdateTriggerLabel(elements, state);
        },
    };
}
