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

function createSlackService(client = new WebClient(process.env.SLACK_BOT_TOKEN)) {
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
    return messages.filter((msg) => isRealMessage(msg, botId));
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

module.exports = createSlackService();
module.exports.createSlackService = createSlackService;
