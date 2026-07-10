const { WebClient } = require('@slack/web-api');

const SYSTEM_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'bot_add',
  'bot_remove',
]);

function isRealMessage(msg, ownBotId) {
  if (msg.bot_id && msg.bot_id === ownBotId) return false;
  if (msg.subtype && SYSTEM_SUBTYPES.has(msg.subtype)) return false;
  return true;
}

const MENTION_RE = /<@([A-Z0-9]+)>/g;
const MAILTO_RE = /<mailto:([^|>]+)(?:\|([^>]+))?>/g;
const LINK_RE = /<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g;

async function resolveMentions(text, client, nameCache) {
  if (!text) return text;
  const ids = [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1]))];
  await Promise.all(
    ids
      .filter((id) => !nameCache.has(id))
      .map(async (id) => {
        try {
          const { user } = await client.users.info({ user: id });
          nameCache.set(id, user.profile?.real_name || user.real_name || user.name || id);
        } catch {
          nameCache.set(id, id);
        }
      })
  );
  return text
    .replace(MENTION_RE, (_, id) => `@${nameCache.get(id)}`)
    .replace(MAILTO_RE, (_, email, label) => label || email)
    .replace(LINK_RE, (_, url, label) => label || url);
}

function createSlackService({ client } = {}) {
  if (!client) throw new Error('createSlackService: client is required');
  let ownBotId;

  async function getOwnBotId() {
    if (ownBotId === undefined) {
      const auth = await client.auth.test();
      ownBotId = auth.bot_id;
    }
    return ownBotId;
  }

  async function getMessages(channel, oldest, latest) {
    const botId = await getOwnBotId();
    const messages = [];
    let cursor;
    do {
      const res = await client.conversations.history({
        channel,
        oldest,
        latest,
        inclusive: false,
        limit: 200,
        cursor,
      });
      messages.push(...res.messages);
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);

    const realMessages = messages.filter((msg) => isRealMessage(msg, botId));
    const nameCache = new Map();
    for (const msg of realMessages) {
      msg.text = await resolveMentions(msg.text, client, nameCache);
    }
    return realMessages;
  }

  async function postListo(channel, threadTs) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: 'Listo',
    });
  }

  return { getMessages, postListo };
}

module.exports = { createSlackService };
module.exports.createSlackService = createSlackService;