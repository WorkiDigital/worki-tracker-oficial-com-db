// Calcula minutos decorridos entre 2 timestamps, contando só o tempo dentro do
// horário comercial configurado (opt-in, usado pelo Índice de Engajamento
// Comercial). Função pura, sem dependência de banco — itera dia a dia entre
// startTs e endTs, o que é simples de testar e barato o bastante para o
// volume por requisição (leads de um período), sem precisar de SQL nativo.
//
// Escopo deliberadamente mínimo: sem feriados, sem exceções, sem múltiplos
// turnos por dia — 1 janela fixa (início/fim) + lista de dias úteis.

/** Extrai {hour, minute} de uma string "HH:MM". */
function parseHHMM(str) {
  const [h, m] = String(str || '00:00').split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

/**
 * @param {Date|string} startTs
 * @param {Date|string} endTs
 * @param {{business_hours_start: string, business_hours_end: string, business_days: number[]}} config
 * @returns {number} minutos dentro do horário comercial entre startTs e endTs
 */
export function calcBusinessMinutes(startTs, endTs, config) {
  const start = new Date(startTs);
  const end = new Date(endTs);
  if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end)) return 0;
  if (end <= start) return 0;

  const { hour: startHour, minute: startMinute } = parseHHMM(config?.business_hours_start);
  const { hour: endHour, minute: endMinute } = parseHHMM(config?.business_hours_end);
  const businessDays = new Set(Array.isArray(config?.business_days) ? config.business_days : [1, 2, 3, 4, 5]);

  let totalMinutes = 0;
  // Itera dia a dia entre start e end (inclusive), somando só a interseção de
  // cada dia com a janela [startHour:startMinute, endHour:endMinute].
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  while (cursor <= lastDay) {
    const isoWeekday = cursor.getDay() === 0 ? 7 : cursor.getDay(); // 1=segunda...7=domingo
    if (businessDays.has(isoWeekday)) {
      const dayBusinessStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), startHour, startMinute);
      const dayBusinessEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), endHour, endMinute);

      const windowStart = start > dayBusinessStart ? start : dayBusinessStart;
      const windowEnd = end < dayBusinessEnd ? end : dayBusinessEnd;

      if (windowEnd > windowStart) {
        totalMinutes += (windowEnd.getTime() - windowStart.getTime()) / 60000;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return Math.max(0, totalMinutes);
}
