'use strict';
// Dependency-free process harness, also used by chaos.ps1.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const mode = process.argv[2] || 'baseline';
if (!['baseline', 'latency', 'chaos'].includes(mode)) throw new Error('Use baseline, latency, or chaos');
const runName = process.env.LAB_RUN_NAME || mode;
if (!/^[a-z0-9-]+$/.test(runName)) throw new Error('LAB_RUN_NAME must contain lowercase letters, digits, or hyphens');
const dir = path.join(__dirname, 'logs', runName);
fs.mkdirSync(dir, { recursive: true });
// Only overwrite this experiment's known output files.
for (const name of ['server.log', 'client.log', 'run.log', 'results.json']) fs.writeFileSync(path.join(dir, name), '');
function record(text) {
  const line = `${new Date().toISOString()} ${text}`;
  console.log(line);
  fs.appendFileSync(path.join(dir, 'run.log'), line + '\n');
}
const children = [];
function start(file, args, env) {
  const fd = fs.openSync(path.join(dir, file.replace('.js', '.log')), 'w');
  let child;
  try { child = spawn(process.execPath, [path.join(__dirname, file), ...args], { env, stdio: ['ignore', fd, fd], windowsHide: true }); }
  finally { fs.closeSync(fd); }
  const entry = { child, done: false };
  entry.finished = new Promise(resolve => {
    child.on('error', error => { entry.error = error.message; record(`spawn error: ${error.message}`); });
    child.on('close', (code, signal) => { entry.done = true; entry.exit = { code, signal }; resolve(entry.exit); });
  });
  children.push(entry);
  record(`${file} started pid=${child.pid}`);
  return entry;
}
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
async function until(predicate, milliseconds, description) {
  const deadline = Date.now() + milliseconds;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await sleep(20);
  }
}
async function portFree() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 4000, exclusive: true }, () => probe.close(resolve));
  });
  record('Port 4000 bind check passed');
}
function alive(entry) {
  if (entry.done) return false;
  try { process.kill(entry.child.pid, 0); return true; } catch { return false; }
}
async function main() {
  record(`mode=${mode}; OS=${os.platform()} ${os.release()}; Node=${process.version}`);
  await portFree();
  const delay = mode === 'baseline' ? 0 : 200;
  const server = start('server.js', [], { ...process.env, ACK_DELAY_MS: String(delay) });
  await until(() => {
    if (server.done) throw new Error('Server exited before readiness');
    return read('server.log').includes('listening on 127.0.0.1:4000');
  }, 5000, 'server readiness');
  const custom = process.argv.length > 3;
  const client = start('client.js', custom ? [process.argv[3]] : [], process.env);
  const first = custom ? process.argv[3] : 'hello-1';
  await until(() => {
    if (client.done) throw new Error('Client exited before first acknowledgment');
    return read('client.log').includes(`ack ${JSON.stringify(first)};`);
  }, 5000, 'first acknowledgment');
  const bothAlive = alive(server) && alive(client);
  record(`Process snapshot: server pid=${server.child.pid} alive=${alive(server)}; client pid=${client.child.pid} alive=${alive(client)}`);
  if (!bothAlive) throw new Error('Expected two live processes');
  if (mode === 'chaos') {
    await sleep(100);
    record(`First acknowledgment observed; waited 100ms; forcibly terminating only server pid=${server.child.pid}`);
    if (!server.child.kill('SIGKILL')) throw new Error('Could not kill experiment server');
  }
  await until(() => client.done, 10000, 'client completion');
  record(`Client exit=${JSON.stringify(client.exit)}`);
  const serverRemains = alive(server);
  if (mode !== 'chaos') {
    record(`Server remains alive after client exit: ${serverRemains}`);
    if (!serverRemains) throw new Error('Server unexpectedly exited');
    record(`Cleanup: stopping only server pid=${server.child.pid}`);
    server.child.kill('SIGTERM');
  }
  await until(() => server.done, 3000, 'server completion');
  record(`Server exit=${JSON.stringify(server.exit)}`);
  const rtts = [...read('client.log').matchAll(/RTT=([\d.]+)ms/g)].map(match => Number(match[1]));
  const result = {
    mode, recordedAt: new Date().toISOString(), ackDelayMs: delay,
    serverPid: server.child.pid, clientPid: client.child.pid, bothAlive,
    serverAliveAfterClient: serverRemains, clientExit: client.exit, serverExit: server.exit,
    rttsMs: rtts, meanRttMs: rtts.reduce((sum, value) => sum + value, 0) / rtts.length
  };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  for (const name of ['server.log', 'client.log']) {
    console.log(`\n=== ${name} ===\n${read(name)}`);
  }
  record('Experiment completed');
}
main().catch(error => { record(`EXPERIMENT FAILED: ${error.message}`); process.exitCode = 1; }).finally(async () => {
  for (const entry of children) if (!entry.done) entry.child.kill('SIGKILL');
  await Promise.all(children.map(entry => entry.finished));
});
