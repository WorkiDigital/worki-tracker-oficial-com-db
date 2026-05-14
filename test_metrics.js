import { getPool } from './api/_db.js';

async function run() {
  try {
    const pool = getPool();
    const res = await pool.query(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (sale_closed_at - created_at))/86400) FILTER (WHERE sale_closed_at IS NOT NULL) as avg_cycle_days,
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) FILTER (WHERE first_response_at IS NOT NULL) as avg_response_min,
        COUNT(*) FILTER (WHERE last_interaction_at < NOW() - INTERVAL '48 hours' AND status NOT IN ('venda_fechada', 'perdido', 'Vendido')) as leads_at_risk,
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL AND EXTRACT(EPOCH FROM (sale_closed_at - created_at))/3600 < 24) as fast_sales,
        COUNT(*) FILTER (WHERE sale_closed_at IS NOT NULL) as total_sales
      FROM leads_tracking
    `);
    console.log(res.rows[0]);
    process.exit(0);
  } catch(e) { 
    console.error(e); 
    process.exit(1); 
  }
}
run();
