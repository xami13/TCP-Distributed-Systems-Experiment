# Hello, Distributed System

Two separate Node.js processes communicate over TCP at `127.0.0.1:4000`. No npm packages or install step are required. Use Node.js 18 or newer. The measured run used Windows, PowerShell 5.1, and Node.js v24.19.0. Ubuntu WSL was installed but `node` was unavailable there, so the Windows workflow was used without installing a second runtime.

## Files

- `server.js`: TCP server; newline-delimited JSON greeting and acknowledgments.
- `client.js`: newline-delimited text requests, buffered JSON replies, RTT measurement, and bounded timeouts.
- `chaos.ps1`: PowerShell entry point for the chaos experiment.
- `experiments.js`: shared process/log harness for all three experiments; Node built-in modules only.
- `verify.js`: focused integration checks for framing, timeouts, and connection refusal.
- `logs/baseline`, `logs/latency`, `logs/chaos`: actual experiment output, PID snapshots, exit status, and JSON results.
- `logs/chaos-custom`: additional custom-message run.
- `lab-report.md`: observations and explanations based on these logs.

## Reproduce the experiments

In PowerShell:

```powershell
Set-Location 
node --version
node experiments.js baseline
node experiments.js latency
.\chaos.ps1
```

Run these commands sequentially. Each run checks that port 4000 can be bound, starts a fresh server and client, and saves both stdout and stderr to the respective log files. Baseline and latency each take roughly eight seconds; chaos takes about one second. Each run overwrites only the four known result files in its own log directory. Copy the logs first if you want to keep an earlier measurement.

The harness records exact child PIDs, checks their liveness while both are running, waits for the client to finish, and cleans up only its own processes. It aborts on a busy port; it does not terminate the existing listener. Readiness and acknowledgment waits are bounded at five seconds, client completion at ten seconds, and server completion at three seconds.

For chaos, the harness uses a 200 ms acknowledgment delay, waits for the first acknowledgment, waits another approximately 100 ms, and forcibly terminates its own server. The result may be FIN, ECONNRESET, or another socket error. The harness exits 0 when the experiment itself completes; the **client's separate exit code** is printed and recorded in `results.json`. A chaos client exit of 1 is an expected observation, not a harness failure.

Optional custom message, saved separately to retain the default chaos evidence:

```powershell
$env:LAB_RUN_NAME = 'chaos-custom'
.\chaos.ps1 -Message 'custom payload with spaces'
Remove-Item Env:LAB_RUN_NAME
```

Custom messages must be a single line. The harness matches the actual custom acknowledgment, rather than always waiting for `hello-1`.

If local PowerShell execution policy blocks the script, the same workflow can be run directly without changing policy:

```powershell
node experiments.js chaos
node experiments.js chaos 'custom payload with spaces'
```

## Run manually in two terminals

Terminal A:

```powershell
Set-Location D:\.dev\.pc\sd-lab-02
$env:ACK_DELAY_MS = '0'
node server.js
```

Terminal B:

```powershell
Set-Location D:\.dev\.pc\sd-lab-02
node client.js
# Or one custom message:
node client.js 'my message'
```

To reproduce latency manually, stop the server with Ctrl+C in its own terminal, set `$env:ACK_DELAY_MS = '200'`, and start it again. Rerun the client. The first send is about 250 ms after the greeting; subsequent sends are about one second apart. After all replies, the connection idles until its five-second timeout. The server listener remains running.

To inspect live processes in a third terminal, substitute the PIDs printed by this run:

```powershell
Get-Process -Id <server-pid>,<client-pid>
```

For manual redirection that preserves errors:

```powershell
node client.js > manual-client.log 2>&1
$LASTEXITCODE
```

The automated harness directs both child output streams to the same file descriptor. Client errors use stderr, and natural process termination lets output drain.

## Verification

```powershell
node --check server.js
node --check client.js
node --check experiments.js
node verify.js
```

Verification takes about 22 seconds and needs port 4000 free. It records `logs/verification.log`. Test-server RTTs in this file are deliberately affected by framing tests; use the experiment directories for latency comparisons.

## Linux/Bash equivalent

The JavaScript is also usable with Node.js 18+ installed on Linux/WSL:

```bash
cd /mnt/d/.dev/.pc/sd-lab-02
node experiments.js baseline
node experiments.js latency
node experiments.js chaos
node experiments.js chaos 'custom payload'
# Manual delayed server:
ACK_DELAY_MS=200 node server.js
```

These Linux execution commands were not verified because the available Ubuntu distribution had no Node.js. PowerShell sets environment variables with `$env:NAME`, rather than Bash's `NAME=value command`. The harness replaces Bash background jobs, `$!`, `wait`, and `kill` with Node child-process APIs. On Windows, Node's `SIGKILL` request forcibly terminates the target process; it is not a native POSIX signal. The recorded `signal` is Node's child-process termination status. No `pkill`, broad name matching, or unrelated process cleanup is used.

