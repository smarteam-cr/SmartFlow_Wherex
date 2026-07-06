import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const historyMock = vi.fn();
const postMessageMock = vi.fn();

const fakeClient = {
  conversations: { history: historyMock },
  chat: { postMessage: postMessageMock },
};

let slack;

beforeEach(() => {
  vi.clearAllMocks();
  const { createSlackService } = require('../src/services/slack');
  slack = createSlackService(fakeClient);
});

describe('services/slack.getMessages', () => {
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

    const messages = await slack.getMessages('C0TEST', '1.0', '3.0');

    expect(messages).toHaveLength(2);
    expect(historyMock).toHaveBeenCalledTimes(2);
    expect(historyMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'cursor1' }));
  });

  it('filters out bot messages', async () => {
    historyMock.mockResolvedValueOnce({
      messages: [
        { ts: '1.1', text: 'human', user: 'U1' },
        { ts: '1.2', text: 'bot', bot_id: 'B1' },
        { ts: '1.3', text: 'sys', subtype: 'bot_message' },
      ],
      response_metadata: {},
    });

    const messages = await slack.getMessages('C0TEST', '1.0', '3.0');

    expect(messages).toEqual([{ ts: '1.1', text: 'human', user: 'U1' }]);
  });
});

describe('services/slack.postListo', () => {
  it('posts "Listo" to the resolved thread', async () => {
    await slack.postListo('C0TEST', '1.1');
    expect(postMessageMock).toHaveBeenCalledWith({
      channel: 'C0TEST',
      thread_ts: '1.1',
      text: 'Listo',
    });
  });
});
