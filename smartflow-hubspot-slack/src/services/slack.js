const { WebClient } = require('@slack/web-api');

function isRealMessage(msg) {
  return !msg.bot_id && msg.subtype !== 'bot_message';
}

function createSlackService(client = new WebClient(process.env.SLACK_BOT_TOKEN)) {
  async function getMessages(channel, oldest, latest) {
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
    return messages.filter(isRealMessage);
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
