'use strict';
const net = require('node:net');
const { performance } = require('node:perf_hooks');

const messages = process.argv.length > 2 ? [process.argv[2]] : ['hello-1', 'hello-2', 'hello-3'];
if (messages.some(message => /[\r\n]/.test(message))) {
  console.error('Custom message must be a single line.');
  process.exitCode = 1;
} else {
  const log = text => console.log(`[client pid=${process.pid}] ${text}`);
  const socket = new net.Socket();
  const sent = new Map();
  const rtts = [];
  let buffer = '', sendTimer, index = 0, greeted = false;
  let reason = 'connection closed';
  let greetingAt;
  function fail(text) {
    reason = text;
    console.error(`[client pid=${process.pid}] ${text}`);
    process.exitCode = 1;
    socket.destroy();
  }
  function sendNext() {
    if (socket.destroyed || !socket.writable || index === messages.length) return;
    const text = messages[index++];
    const now = performance.now();
    sent.set(text, now);
    log(`sending ${JSON.stringify(text)}; sinceGreetingMs=${(now - greetingAt).toFixed(3)}`);
    socket.write(text + '\n');
    if (index < messages.length) sendTimer = setTimeout(sendNext, 1000);
  }
  const hardTimer = setTimeout(() => fail('hard timeout 8000ms'), 8000);
  socket.on('error', error => fail(`socket error: ${error.code || error.message}`));
  socket.on('connect', () => log('connected to 127.0.0.1:4000'));
  socket.on('end', () => { reason = 'remote end (FIN)'; log(reason); clearTimeout(sendTimer); });
  socket.on('close', hadError => {
    clearTimeout(sendTimer);
    clearTimeout(hardTimer);
    socket.setTimeout(0);
    log(`closed; hadError=${hadError}; reason=${reason}; acknowledged=${rtts.length}/${messages.length}`);
    log(`RTT samples: [${rtts.map(value => value.toFixed(3)).join(', ')}] ms`);
    log(`exit code=${process.exitCode || 0}`);
    // Let Node exit naturally so redirected stdout and stderr can drain.
  });
  socket.setEncoding('utf8');
  socket.setTimeout(5000, () => { reason = 'idle timeout 5000ms'; log(reason); socket.destroy(); });
  socket.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); }
      catch { fail('invalid JSON from server'); return; }
      if (message.type === 'greeting' && !greeted) {
        greeted = true;
        greetingAt = performance.now();
        log(`greeting from server pid=${message.pid}; counter=${message.counter}`);
        sendTimer = setTimeout(sendNext, 250);
      } else if (message.type === 'ack' && sent.has(message.echo)) {
        const rtt = performance.now() - sent.get(message.echo);
        sent.delete(message.echo);
        rtts.push(rtt);
        log(`ack ${JSON.stringify(message.echo)}; server pid=${message.pid}; counter=${message.counter}; RTT=${rtt.toFixed(3)}ms`);
      } else { fail('unexpected server message'); return; }
    }
  });
  log('starting');
  socket.connect(4000, '127.0.0.1');
}

