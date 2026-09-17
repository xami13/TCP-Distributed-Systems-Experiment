'use strict';
// Focused integration checks; uses only built-in modules and real TCP sockets.
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const logFile = path.join(__dirname, 'logs', 'verification.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, '');
function log(text) { console.log(text); fs.appendFileSync(logFile, text + '\n'); }
async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert(Date.now() < deadline, 'bounded wait expired'); await sleep(10); }
}
const children = [], servers = [], sockets = [];
function launch(file, args = [], env = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, file), ...args], {
    env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const run = { child, output: '', done: false };
  children.push(run);
  child.stdout.on('data', data => { run.output += data; });
  child.stderr.on('data', data => { run.output += data; });
  child.on('error', error => { run.output += error.message; });
  child.on('close', (code, signal) => { run.done = true; run.code = code; run.signal = signal; });
  return run;
}
async function finish(run, timeout = 10000) {
  await until(() => run.done, timeout);
  log(run.output.trim());
  log(`Observed exit: pid=${run.child.pid} code=${run.code} signal=${run.signal}`);
}
async function fake(handler) {
  const server = net.createServer(socket => {
    sockets.push(socket);
    socket.on('error', () => {});
    handler(socket);
  });
  servers.push(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4000, '127.0.0.1', resolve); });
  return server;
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }
async function main() {
  log(`Verification started ${new Date().toISOString()}; Node=${process.version}`);
  // Claim the port once before launching any process; never kill an existing listener.
  const probe = await fake(() => {}); await close(probe);
  const real = launch('server.js', [], { ACK_DELAY_MS: '0' });
  await until(() => real.output.includes('listening'));
  const socket = net.createConnection(4000, '127.0.0.1');
  sockets.push(socket);
  socket.on('error', error => log(`probe error: ${error.message}`));
  let buffer = ''; const received = [];
  socket.setEncoding('utf8');
  socket.on('data', data => {
    buffer += data; let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      received.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1);
    }
  });
  await until(() => received.length === 1);
  socket.write('frag'); await sleep(60);
  assert.equal(received.length, 1, 'no acknowledgment before newline');
  socket.write('mented\nsecond\nthird\n');
  await until(() => received.length === 4);
  assert.deepEqual(received.slice(1).map(item => item.echo), ['fragmented', 'second', 'third']);
  assert.deepEqual(received.map(item => item.counter), [1, 2, 3, 4]);
  assert(received.every(item => item.pid === real.child.pid));
  log('PASS server: split input, multiple lines, exact echoes, PID and counters');
  await until(() => socket.destroyed, 6500);
  assert(real.output.includes('idle timeout 5000ms'));
  log('PASS server: idle peer disconnected at five-second timeout');
  real.child.kill('SIGTERM'); await finish(real);

  const refused = launch('client.js'); await finish(refused);
  assert.equal(refused.code, 1); assert.match(refused.output, /ECONNREFUSED/);
  assert.match(refused.output, /RTT samples: \[\]/);
  log('PASS client: refused connection preserves error and empty RTT summary');

  const framing = await fake(peer => {
    peer.write('{"type":"gree');
    setTimeout(() => peer.write(`ting","pid":${process.pid},"counter":1}\n`), 60);
    let input = '', messages = [];
    peer.on('data', data => {
      input += data; let i;
      while ((i = input.indexOf('\n')) >= 0) {
        messages.push(input.slice(0, i)); input = input.slice(i + 1);
      }
      if (messages.length === 3) {
        const output = messages.map((echo, n) => JSON.stringify({ type: 'ack', pid: process.pid, counter: n + 2, echo }) + '\n').join('');
        peer.write(output.slice(0, 8));
        setTimeout(() => peer.end(output.slice(8)), 60);
      }
    });
  });
  const framed = launch('client.js'); await finish(framed);
  assert.equal(framed.code, 0); assert.match(framed.output, /acknowledged=3\/3/);
  await close(framing);
  log('PASS client: split greeting/JSON and multiple acknowledgments in a stream');

  const silent = await fake(() => {});
  const idle = launch('client.js'); await finish(idle);
  assert.match(idle.output, /idle timeout 5000ms/); assert.equal(idle.code, 0);
  await close(silent); log('PASS client: idle timeout and timer cleanup');

  const busy = await fake(peer => {
    // Partial JSON bytes keep resetting idle time, but never complete a greeting.
    peer.write('{');
    const timer = setInterval(() => peer.write(' '), 500);
    peer.on('close', () => clearInterval(timer));
  });
  const hard = launch('client.js'); await finish(hard);
  assert.match(hard.output, /hard timeout 8000ms/); assert.equal(hard.code, 1);
  await close(busy); log('PASS client: hard timeout even while incoming bytes prevent idle timeout');
  log('All verification checks passed. Test-server RTTs above are not baseline measurements.');
}
main().catch(error => { log(`FAIL: ${error.stack}`); process.exitCode = 1; }).finally(() => {
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
  for (const run of children) if (!run.done) run.child.kill('SIGKILL');
});
