import handlerAdPreview      from '../handlers/ad-preview.js';
import handlerAdsAccounts    from '../handlers/ads-accounts.js';
import handlerAdsBest        from '../handlers/ads-best.js';
import handlerAdsChildren    from '../handlers/ads-children.js';
import handlerAdsDemo        from '../handlers/ads-demo.js';
import handlerAdsPlacement   from '../handlers/ads-placement.js';
import handlerAds            from '../handlers/ads.js';
import handlerAuthLogin      from '../handlers/auth-login.js';
import handlerAuthRegister   from '../handlers/auth-register.js';
import handlerClientes       from '../handlers/clientes.js';
import handlerConfig         from '../handlers/config.js';
import handlerEvoManager     from '../handlers/evo-manager.js';
import handlerLeadsUpdate    from '../handlers/leads-update.js';
import handlerLeads          from '../handlers/leads.js';
import handlerLogs           from '../handlers/logs.js';
import handlerShareAds       from '../handlers/share-ads.js';
import handlerShareBest      from '../handlers/share-best.js';
import handlerShareCreate    from '../handlers/share-create.js';
import handlerShareDemo      from '../handlers/share-demo.js';
import handlerShareList      from '../handlers/share-list.js';
import handlerSharePlacement from '../handlers/share-placement.js';
import handlerSharePreview   from '../handlers/share-preview.js';
import handlerShareUpdate    from '../handlers/share-update.js';
import handlerShareVideo     from '../handlers/share-video.js';
import handlerVideoSource    from '../handlers/video-source.js';
import handlerWebhookEvo     from '../handlers/webhook-evo.js';
import handlerWebhookN8n     from '../handlers/webhook-n8n.js';

const ROUTES = {
  'ad-preview':      handlerAdPreview,
  'ads-accounts':    handlerAdsAccounts,
  'ads-best':        handlerAdsBest,
  'ads-children':    handlerAdsChildren,
  'ads-demo':        handlerAdsDemo,
  'ads-placement':   handlerAdsPlacement,
  'ads':             handlerAds,
  'auth-login':      handlerAuthLogin,
  'auth-register':   handlerAuthRegister,
  'clientes':        handlerClientes,
  'config':          handlerConfig,
  'evo-manager':     handlerEvoManager,
  'leads-update':    handlerLeadsUpdate,
  'leads':           handlerLeads,
  'logs':            handlerLogs,
  'share-ads':       handlerShareAds,
  'share-best':      handlerShareBest,
  'share-create':    handlerShareCreate,
  'share-demo':      handlerShareDemo,
  'share-list':      handlerShareList,
  'share-placement': handlerSharePlacement,
  'share-preview':   handlerSharePreview,
  'share-update':    handlerShareUpdate,
  'share-video':     handlerShareVideo,
  'video-source':    handlerVideoSource,
  'webhook-evo':     handlerWebhookEvo,
  'webhook-n8n':     handlerWebhookN8n,
};

export default async function handler(req, res) {
  const slugParts = req.query.slug;
  const routeKey  = Array.isArray(slugParts) ? slugParts.join('/') : String(slugParts || '');
  const fn = ROUTES[routeKey];
  if (!fn) return res.status(404).json({ error: `Route not found: /api/${routeKey}` });
  return fn(req, res);
}
