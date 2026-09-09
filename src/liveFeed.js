// Relays live-ish price updates to browser clients.
//
// Yahoo Finance's keyless endpoints don't offer a public trade WebSocket,
// so instead of proxying an upstream stream we poll `getQuote` per watched
// symbol on a short interval and push updates to browsers over our own
// WebSocket as soon as they arrive — no client has to poll itself, and we
// only ever make one upstream request per symbol per interval no matter
// how many browsers are watching it.

import { getQuote } from './yahoo.js';

const POLL_INTERVAL_MS = 5000;

export class LiveFeed {
  constructor() {
    this.subscriberCounts = new Map(); // symbol -> count of watching clients
    this.pollers = new Map(); // symbol -> interval handle
    this.clients = new Set(); // browser WebSocket connections
    this.clientSymbols = new Map(); // client -> Set(symbol)
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
    const symbols = this.clientSymbols.get(ws);
    if (!symbols || symbols.has(symbol)) return;
    symbols.add(symbol);

    const count = this.subscriberCounts.get(symbol) || 0;
    this.subscriberCounts.set(symbol, count + 1);
    if (count === 0) this.startPolling(symbol);
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
      this.stopPolling(symbol);
    } else {
      this.subscriberCounts.set(symbol, count - 1);
    }
  }

  startPolling(symbol) {
    const poll = async () => {
      try {
        const quote = await getQuote(symbol);
        if (quote) {
          this.broadcast(symbol, {
            type: 'tick',
            symbol,
            price: quote.price,
            change: quote.change,
            changePct: quote.changePct,
            ts: Date.now(),
          });
        }
      } catch {
        // transient upstream error; next poll will retry
      }
    };
    poll();
    this.pollers.set(symbol, setInterval(poll, POLL_INTERVAL_MS));
  }

  stopPolling(symbol) {
    const handle = this.pollers.get(symbol);
    if (handle) clearInterval(handle);
    this.pollers.delete(symbol);
  }

  removeClient(ws) {
    const symbols = this.clientSymbols.get(ws) || new Set();
    for (const symbol of symbols) this.decrementSymbol(symbol);
    this.clientSymbols.delete(ws);
    this.clients.delete(ws);
  }
}
