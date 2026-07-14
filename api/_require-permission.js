// Enforcement de permissões por módulo no BACKEND. Antes disso, `permissoes`
// (JSONB em clientes) só era usado no frontend pra esconder abas/botões — um
// cliente com a aba escondida ainda conseguia chamar a API direto e receber os
// dados normalmente. Mesma regra de default do frontend (index.html, tabMap):
// permissoes[key] !== false — ausência de configuração = permitido (não
// quebra clientes existentes que nunca tiveram `permissoes` setado).
//
// Uso: logo após verifyAuth, antes de qualquer acesso a dado do módulo.
//   const user = await verifyAuth(req, res);
//   if (!user) return;
//   if (requirePermission(user, res, 'leads')) return;
export function requirePermission(user, res, key) {
  if (user.is_admin) return false;
  const permissoes = user.permissoes || {};
  if (permissoes[key] === false) {
    res.status(403).json({ error: 'PERMISSION_DENIED', message: 'Você não possui permissão para acessar este recurso.' });
    return true;
  }
  return false;
}
