'use strict';
const net = require('node:net');

const delay = Number(process.env.ACK_DELAY_MS || 0);
if (!Number.isFinite(delay) || delay < 0) throw new Error('ACK_DELAY_MS must be nonnegative');
let counter = 0;
const log = text => console.log(`[server pid=${process.pid}] ${text}`);
const server = net.createServer(socket => {
  let buffer = '';
  const timers = new Set();
  const cleanup = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    socket.setTimeout(0);
  };
  // Register errors before the greeting or any other write.
  socket.on('error', error => console.error(`[server pid=${process.pid}] socket error: ${error.code || error.message}`));
  socket.on('end', () => { cleanup(); log('client ended connection'); });
  socket.on('close', hadError => { cleanup(); log(`disconnected; hadError=${hadError}`); });
  socket.setEncoding('utf8');
  socket.setTimeout(5000, () => { log('idle timeout 5000ms'); socket.destroy(); });
  const send = message => {
    if (!socket.destroyed && socket.writable) socket.write(JSON.stringify(message) + '\n');
  };
  socket.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      log(`received ${JSON.stringify(line)}`);
      const ack = { type: 'ack', pid: process.pid, counter: ++counter, echo: line };
      if (delay === 0) send(ack);
      else {
        const timer = setTimeout(() => { timers.delete(timer); send(ack); }, delay);
        timers.add(timer);
      }
    }
  });
  log('client connected');
  send({ type: 'greeting', pid: process.pid, counter: ++counter });
});
server.on('error', error => {
  console.error(`[server pid=${process.pid}] server error: ${error.code || error.message}`);
  process.exitCode = 1;
});
server.listen(4000, '127.0.0.1', () => log(`listening on 127.0.0.1:4000; ackDelayMs=${delay}`));

