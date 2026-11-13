'use strict';
/* Small guards for the raw Node HTTP server.
   Based on the Node.js security best-practices guide (nodejs.org/en/guides/security):
   - CWE-400: time limits so slow or idle connections are dropped
   - CWE-1321: JSON bodies may not carry __proto__ / constructor / prototype keys */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/* JSON.parse that refuses prototype-polluting keys at any depth.
   JSON.parse itself creates "__proto__" as a plain own property, but any later
   Object.assign / spread of that value would then replace an object's prototype. */
function parseJsonSafe(text) {
  return JSON.parse(text, (key, value) => {
    if (FORBIDDEN_KEYS.has(key)) {
      const err = new Error('bad request body');
      err.code = 'FORBIDDEN_KEY';
      throw err;
    }
    return value;
  });
}

/* Time limits for the HTTP server. headersTimeout must not exceed requestTimeout. */
function applyTimeouts(server, { headersMs, requestMs, keepAliveMs, maxRequestsPerSocket }) {
  server.headersTimeout = Math.min(headersMs, requestMs);
  server.requestTimeout = requestMs;
  server.keepAliveTimeout = keepAliveMs;
  server.maxRequestsPerSocket = maxRequestsPerSocket;
  // a malformed request or a dropped connection must never take the process down
  server.on('clientError', (err, socket) => {
    if (err.code === 'ECONNRESET' || !socket.writable) { socket.destroy(); return; }
    const status = err.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout' : '400 Bad Request';
    socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\n\r\n');
  });
  server.on('connection', socket => socket.on('error', () => socket.destroy()));
  return server;
}

module.exports = { parseJsonSafe, applyTimeouts, FORBIDDEN_KEYS };
