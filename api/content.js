import { Redis } from '@upstash/redis';

const KEY = 'sag_site_content';

// Connexion au stockage Upstash, créée seulement quand on en a besoin.
// On accepte plusieurs noms de variables selon la façon dont Vercel les injecte.
function getRedis() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_API_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // LECTURE : renvoie le contenu enregistré (ou {} si pas de stockage)
    if (req.method === 'GET') {
      const redis = getRedis();
      if (!redis) return res.status(200).json({});
      const data = await redis.get(KEY);
      return res.status(200).json(data || {});
    }

    if (req.method === 'POST') {
      const body =
        typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      // Vérification du mot de passe (indépendante du stockage)
      if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
      }

      // Simple déverrouillage de l'éditeur : ne nécessite pas le stockage
      if (body.verify) {
        return res.status(200).json({ ok: true });
      }

      // Enregistrement du contenu (nécessite le stockage)
      const redis = getRedis();
      if (!redis) {
        return res.status(500).json({ error: 'Stockage non configuré (Upstash manquant)' });
      }
      await redis.set(KEY, body.data || {});
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
