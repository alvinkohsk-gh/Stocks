// Relays live trade ticks from Finnhub's WebSocket API to browser clients.
//
// One upstream connection to Finnhub is shared across all browser clients;
// we track which symbols each client wants and keep a refcount so we only
// subscribe/unsubscribe from Finnhub when the last/first client for a
// symbol leaves/joins. Ticks are forwarded to browsers as soon as they
// arrive — no polling delay.

import WebSocket from 'ws';
import { FINNHUB_WS_URL, hasFinnhubKey } from './finnhub.js';

const RECONNECT_DELAY_MS = 3000;

export class LiveFeed {
  constructor() {
    this.upstream = null;
    this.subscriberCounts = new Map(); // symbol -> count of watching clients
    this.clients = new Set(); // browser WebSocket connections
    this.clientSymbols = new Map(); // client -> Set(symbol)
    this.enabled = hasFinnhubKey();
    if (this.enabled) this.connectUpstream();
  }

  connectUpstream() {
    const ws = new WebSocket(FINNHUB_WS_URL(process.env.FINNHUB_API_KEY));
    this.upstream = ws;

    ws.on('open', () => {
      for (const symbol of this.subscriberCounts.keys()) {
        ws.send(JSON.stringify({ type: 'subscribe', symbol }));
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;
      for (const trade of msg.data) {
        this.broadcast(trade.s, {
          type: 'tick',
          symbol: trade.s,
          price: trade.p,
          volume: trade.v,
          ts: trade.t,
        });
      }
    });

    ws.on('close', () => {
      if (this.enabled) setTimeout(() => this.connectUpstream(), RECONNECT_DELAY_MS);
    });

    ws.on('error', () => {
      ws.close();
    });
  }

  broadcast(symbol, payload) {
    const message = JSON.stringify(payload);
    for (const client of this.clients) {
      const symbols = this.clientSymbols.get(client);
      if (symbols?.has(symbol) && client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }

  addClient(ws) {
    this.clients.add(ws);
    this.clientSymbols.set(ws, new Set());

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'subscribe' && typeof msg.symbol === 'string') {
        this.subscribeClient(ws, msg.symbol.toUpperCase());
      } else if (msg.type === 'unsubscribe' && typeof msg.symbol === 'string') {
        this.unsubscribeClient(ws, msg.symbol.toUpperCase());
      }
    });

    ws.on('close', () => this.removeClient(ws));
  }

  subscribeClient(ws, symbol) {
    if (!this.enabled) {
      ws.send(JSON.stringify({ type: 'error', message: 'Live feed unavailable: FINNHUB_API_KEY not set' }));
      return;
    }
    const symbols = this.clientSymbols.get(ws);
    if (!symbols || symbols.has(symbol)) return;
    symbols.add(symbol);

    const count = this.subscriberCounts.get(symbol) || 0;
    this.subscriberCounts.set(symbol, count + 1);
    if (count === 0 && this.upstream?.readyState === this.upstream?.OPEN) {
      this.upstream.send(JSON.stringify({ type: 'subscribe', symbol }));
    }
  }

  unsubscribeClient(ws, symbol) {
    const symbols = this.clientSymbols.get(ws);
    if (!symbols || !symbols.has(symbol)) return;
    symbols.delete(symbol);
    this.decrementSymbol(symbol);
  }

  decrementSymbol(symbol) {
    const count = this.subscriberCounts.get(symbol) || 0;
    if (count <= 1) {
      this.subscriberCounts.delete(symbol);
      if (this.upstream?.readyState === this.upstream?.OPEN) {
        this.upstream.send(JSON.stringify({ type: 'unsubscribe', symbol }));
      }
    } else {
      this.subscriberCounts.set(symbol, count - 1);
    }
  }

  removeClient(ws) {
    const symbols = this.clientSymbols.get(ws) || new Set();
    for (const symbol of symbols) this.decrementSymbol(symbol);
    this.clientSymbols.delete(ws);
    this.clients.delete(ws);
  }
}
