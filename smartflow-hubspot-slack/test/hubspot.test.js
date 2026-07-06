import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let hubspot;
let fetchMock;

beforeEach(() => {
  process.env.HUBSPOT_TOKEN = 'pat-na1-test';
  process.env.HS_PIPELINE_ID = '0';
  process.env.HS_STAGE_NEW_ID = '1';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  hubspot = require('../src/services/hubspot');
});

describe('services/hubspot.createTicket', () => {
  it('sends the expected ticket body and returns the parsed result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'ticket-1' }),
    });

    const msg = { ts: '1.1', text: 'hola', thread_ts: undefined, user: 'U1' };
    const result = await hubspot.createTicket(msg, 'C0TEST');

    expect(result).toEqual({ id: 'ticket-1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets');
    const body = JSON.parse(opts.body);
    expect(body.properties.slack_message_ts).toBe('1.1');
    expect(body.properties.slack_channel_id).toBe('C0TEST');
    expect(body.properties.slack_thread_ts).toBe('1.1');
  });

  it('throws when the HubSpot API responds with an error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad request' });
    await expect(hubspot.createTicket({ ts: '1.1', text: 'x' }, 'C0TEST')).rejects.toThrow(/400/);
  });
});

describe('services/hubspot.findTicketBySlackTs', () => {
  it('returns null when no ticket matches', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ total: 0, results: [] }) });
    const result = await hubspot.findTicketBySlackTs('1.1');
    expect(result).toBeNull();
  });

  it('returns the first matching ticket', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 1, results: [{ id: 'ticket-1' }] }),
    });
    const result = await hubspot.findTicketBySlackTs('1.1');
    expect(result).toEqual({ id: 'ticket-1' });
  });
});

describe('services/hubspot.getTicket', () => {
  it('fetches a ticket by id with the requested properties', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 't1', properties: {} }) });
    await hubspot.getTicket('t1', ['slack_channel_id', 'slack_thread_ts']);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/crm/v3/objects/tickets/t1');
    expect(url).toContain('properties=slack_channel_id,slack_thread_ts');
  });
});

describe('services/hubspot.markListoSent', () => {
  it('PATCHes the ticket to set slack_listo_sent=true', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 't1' }) });
    await hubspot.markListoSent('t1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.hubapi.com/crm/v3/objects/tickets/t1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ properties: { slack_listo_sent: 'true' } });
  });
});
