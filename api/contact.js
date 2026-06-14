// Fonction serverless Vercel : crée un salon Discord privé (ticket) dans une catégorie
// précise à chaque envoi du formulaire de contact du site, et mentionne le bon rôle
// selon le service choisi.
//
// SEUL SECRET à configurer sur Vercel (Settings > Environment Variables) :
//   DISCORD_BOT_TOKEN  -> le token du bot Discord
//
// Le bot doit être présent sur le serveur avec la permission "Gérer les salons"
// (le plus simple : permission Administrateur).

const VIEW_CHANNEL = 1 << 10;   // 1024
const SEND_MESSAGES = 1 << 11;  // 2048

// --- Identifiants du serveur (modifiables ici, ou via variables d'environnement) ---
const GUILD_ID = process.env.DISCORD_GUILD_ID || '1482324874985734216';
const CATEGORY_ID = process.env.DISCORD_CONTACT_CATEGORY_ID || '1503507667560431687';

// Rôle mentionné + autorisé à voir le salon, selon le "Service concerné" du formulaire.
// La clé doit correspondre EXACTEMENT au texte de l'option dans le menu déroulant du site.
const ROLE_MAP = {
  "Département de la Justice": '1482327806250717316',
  "Département des Finances": '1482327950048104499'
  // Pour ajouter d'autres services, copie une ligne ci-dessus avec son ID de rôle, ex. :
  // "Police d'État": '000000000000000000',
  // "EMS": '000000000000000000',
};
// Rôle utilisé si le service choisi n'est pas dans ROLE_MAP (optionnel) :
const DEFAULT_ROLE = process.env.DISCORD_STAFF_ROLE_ID || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !GUILD_ID || !CATEGORY_ID) {
    return res.status(500).json({ error: "Le contact n'est pas encore configuré côté serveur." });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const pseudo = String(body.pseudo || '').slice(0, 60).trim();
  const discord = String(body.discord || '').slice(0, 40).trim();
  const sujet = String(body.sujet || 'Général').slice(0, 80).trim();
  const message = String(body.message || '').slice(0, 1500).trim();

  if (!pseudo || !message) return res.status(400).json({ error: 'Pseudo et message requis.' });

  const role = ROLE_MAP[sujet] || DEFAULT_ROLE || null;

  const safe = pseudo.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'contact';
  const channelName = 'contact-' + safe;

  const api = 'https://discord.com/api/v10';
  const headers = { 'Authorization': 'Bot ' + token, 'Content-Type': 'application/json' };

  // Salon privé : @everyone ne voit pas ; le rôle concerné + l'auteur (si ID fourni) y ont accès.
  const overwrites = [{ id: GUILD_ID, type: 0, deny: String(VIEW_CHANNEL) }];
  if (role) overwrites.push({ id: role, type: 0, allow: String(VIEW_CHANNEL | SEND_MESSAGES) });
  const userId = /^\d{15,25}$/.test(discord) ? discord : null;
  if (userId) overwrites.push({ id: userId, type: 1, allow: String(VIEW_CHANNEL | SEND_MESSAGES) });

  try {
    const chRes = await fetch(api + '/guilds/' + GUILD_ID + '/channels', {
      method: 'POST', headers,
      body: JSON.stringify({
        name: channelName,
        type: 0,
        parent_id: CATEGORY_ID,
        topic: ('Prise de contact — ' + sujet + ' — ' + pseudo).slice(0, 1024),
        permission_overwrites: overwrites
      })
    });

    if (!chRes.ok) {
      const t = await chRes.text();
      return res.status(502).json({ error: "Création du salon refusée par Discord.", detail: t.slice(0, 300) });
    }
    const channel = await chRes.json();

    const ping = role ? ('<@&' + role + '> ') : '';
    const mentionUser = userId ? (' — <@' + userId + '>') : '';
    const content = ping + '**Nouvelle prise de contact**' + mentionUser;
    const embed = {
      title: 'Demande de ' + pseudo,
      color: 0xC9A24B,
      fields: [
        { name: 'Pseudo RP', value: pseudo.slice(0, 256) },
        { name: 'Service concerné', value: sujet.slice(0, 256) },
        { name: 'Discord', value: (discord || '—').slice(0, 256) },
        { name: 'Message', value: message.slice(0, 1024) }
      ]
    };
    await fetch(api + '/channels/' + channel.id + '/messages', {
      method: 'POST', headers,
      body: JSON.stringify({ content, embeds: [embed], allowed_mentions: { parse: ['roles', 'users'] } })
    });

    return res.status(200).json({ ok: true, channelId: channel.id });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur serveur lors de la création du salon.' });
  }
}
