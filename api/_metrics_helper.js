/**
 * Utilitários para cálculos de métricas temporais (WappTrack Evolution)
 */

/**
 * Diferença em minutos entre duas datas
 */
export function diffInMinutes(start, end) {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    return Math.floor((e - s) / (1000 * 60));
}

/**
 * Diferença em horas entre duas datas
 */
export function diffInHours(start, end) {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    return Math.floor((e - s) / (1000 * 60 * 60));
}

/**
 * Diferença em dias entre duas datas
 */
export function diffInDays(start, end) {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    return Math.floor((e - s) / (1000 * 60 * 60 * 24));
}

/**
 * Formata tempo decorrido de forma amigável (ex: "há 2h", "há 5m")
 */
export function formatRelativeTime(date) {
    if (!date) return '-';
    const now = new Date();
    const diffMin = diffInMinutes(date, now);
    
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin}m`;
    
    const diffHours = diffInHours(date, now);
    if (diffHours < 24) return `há ${diffHours}h`;
    
    const diffDays = diffInDays(date, now);
    return `há ${diffDays}d`;
}
