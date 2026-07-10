import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const historyMock = vi.fn();
const postMessageMock = vi.fn();
const authTestMock = vi.fn();
const usersInfoMock = vi.fn();

const fakeClient = {
  auth: { test: authTestMock },
  conversations: { history: historyMock },
  chat: { postMessage: postMessageMock },
  users: { info: usersInfoMock },
};

let createSlackService;

beforeEach(() => {
  vi.clearAllMocks();
  authTestMock.mockResolvedValue({ bot_id: 'B_OWN' });
  delete require.cache[require.resolve('../../src/modules/slack/services/slack')];
  ({ createSlackService } = require('../../src/modules/slack/services/slack'));
});

describe('modules/slack/services/slack', () => {
  it('factory does NOT read process.env at import time (DI bug fixed)', () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete require.cache[require.resolve('../../src/modules/slack/services/slack')];
    expect(() => require('../../src/modules/slack/services/slack')).not.toThrow();
    expect(createSlackService).toBeDefined();
    expect(typeof createSlackService).toBe('function');
  });

  describe('getMessages', () => {
    it('paginates through cursor results', async () => {
      historyMock
        .mockResolvedValueOnce({
          messages: [{ ts: '1.1', text: 'a' }],
          response_metadata: { next_cursor: 'cursor1' },
        })
        .mockResolvedValueOnce({
          messages: [{ ts: '2.2', text: 'b' }],
          response_metadata: { next_cursor: '' },
        });

      const slack = createSlackService({ client: fakeClient });
      const messages = await slack.getMessages('C0TEST', '1.0', '3.0');

      expect(messages).toHaveLength(2);
      expect(historyMock).toHaveBeenCalledTimes(2);
      expect(historyMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'cursor1' }));
    });

    it("filters out only the bot's own messages and channel system events", async () => {
      historyMock.mockResolvedValueOnce({
        messages: [
          { ts: '1.1', text: 'human', user: 'U1' },
          { ts: '1.2', text: 'own reply', bot_id: 'B_OWN' },
          { ts: '1.3', text: 'workflow bot', bot_id: 'B_OTHER' },
          { ts: '1.4', text: 'joined', subtype: 'channel_join' },
        ],
        response_metadata: {},
      });

      const slack = createSlackService({ client: fakeClient });
      const messages = await slack.getMessages('C0TEST', '1.0', '3.0');

      expect(messages).toEqual([
        { ts: '1.1', text: 'human', user: 'U1' },
        { ts: '1.3', text: 'workflow bot', bot_id: 'B_OTHER' },
      ]);
    });

    it('resolves Slack mentions, mailto links and generic links to plain text', async () => {
      historyMock.mockResolvedValueOnce({
        messages: [
          {
            ts: '1.1',
            text: 'Hola <@U9> revisa <mailto:a@b.com|a@b.com> y <https://x.com|el link>',
          },
          { ts: '1.2', text: 'de nuevo <@U9> confirma' },
        ],
        response_metadata: {},
      });
      usersInfoMock.mockResolvedValue({ user: { real_name: 'Merce Ríos' } });

      const slack = createSlackService({ client: fakeClient });
      const messages = await slack.getMessages('C0TEST', '1.0', '3.0');

      expect(messages).toEqual([
        { ts: '1.1', text: 'Hola @Merce Ríos revisa a@b.com y el link' },
        { ts: '1.2', text: 'de nuevo @Merce Ríos confirma' },
      ]);
      expect(usersInfoMock).toHaveBeenCalledTimes(1);
      expect(usersInfoMock).toHaveBeenCalledWith({ user: 'U9' });
    });

    it('falls back to the raw Slack id when users.info fails to resolve a mention', async () => {
      historyMock.mockResolvedValueOnce({
        messages: [{ ts: '1.1', text: 'Hola <@U9>' }],
        response_metadata: {},
      });
      usersInfoMock.mockRejectedValue(new Error('user_not_found'));

      const slack = createSlackService({ client: fakeClient });
      const messages = await slack.getMessages('C0TEST', '1.0', '3.0');

      expect(messages).toEqual([{ ts: '1.1', text: 'Hola @U9' }]);
    });
  });

  describe('postListo', () => {
    it('posts "Listo" to the resolved thread', async () => {
      const slack = createSlackService({ client: fakeClient });
      await slack.postListo('C0TEST', '1.1');
      expect(postMessageMock).toHaveBeenCalledWith({
        channel: 'C0TEST',
        thread_ts: '1.1',
        text: 'Listo',
      });
    });
  });

  describe('constructor', () => {
    it('throws when client is missing', () => {
      expect(() => createSlackService({})).toThrow(/client/);
    });
  });
});