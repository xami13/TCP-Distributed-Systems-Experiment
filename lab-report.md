# Poridhi lab: Hello, Distributed System

## Objective and architecture

Demonstrate latency, partial failure, and process independence using two separate Node.js processes and a loopback TCP connection.

`client.js (own PID, memory, timers) -> TCP 127.0.0.1:4000 -> server.js (own PID, memory, timers)`

The client sends newline-delimited text. The server sends newline-delimited JSON: a greeting with `type`, `pid`, and `counter`, followed by acknowledgments adding `echo`. The server counter increments across greetings and requests within that server process. TCP is a byte stream: both programs accumulate data and consume complete newline-terminated frames, retaining any unfinished remainder. UTF-8 decoding also handles character boundaries between chunks.

This is a local demonstration of independent processes communicating through a network API; it does not simulate separate machines, routing, partitions, or a production distributed system.

## Environment and steps performed

- Host: Windows NT build 26200; Node reports `win32 10.0.26200`.
- Shell: Windows PowerShell 5.1.26100.9444.
- Runtime: Node.js v24.19.0, using built-in modules only.
- Ubuntu WSL was present, running Linux kernel `6.6.114.1-microsoft-standard-WSL2`, but `wsl -d Ubuntu -- node --version` returned `node: command not found`. The Windows runtime was used instead of installing another runtime.
- Source reference: `D:\.dev\poridhi\LAB\2. distributed system.pdf`. It contains scanned images; the lab text and sample code were read from extracted images. The request's scope controlled the implementation.
- Created `D:\.dev\.pc\sd-lab-02`, implemented server/client and PowerShell chaos entry point, and checked JavaScript syntax.
- Ran baseline with no intentional acknowledgment delay; checked two live PIDs and the server's survival after the client exited.
- Restarted with a 200 ms delay and repeated the client and survival checks.
- Started a fresh delayed server/client for chaos, waited for `hello-1` acknowledgment, waited about 100 ms, then killed only that server.
- Ran another chaos experiment with a custom message containing spaces.
- Ran focused TCP integration checks, saving their real output separately.

Experiments were recorded on **18 September 2026, approximately 03:01:58–03:02:15 Asia/Dhaka (UTC+06)**. The raw log timestamps use UTC, so they show 17 September 21:01:58–21:02:15.

## Actual results

| Experiment | Server PID | Client PID | RTT samples (ms) | Mean RTT (ms) | Client exit code |
|---|---:|---:|---|---:|---:|
| Baseline, 0 ms delay | 26896 | 42004 | 1.033, 0.979, 0.667 | 0.893 | 0 |
| Latency, 200 ms delay | 39956 | 36220 | 204.460, 203.022, 203.742 | 203.741 | 0 |
| Chaos, 200 ms delay | 7912 | 41468 | 202.545 | 202.545 | 1 |
| Custom chaos | 27964 | 14292 | 205.107 | 205.107 | 1 |

Both PIDs were checked as alive together in every experiment. These are actual child PIDs returned by the operating system, checked with Node's process-liveness operation and independently printed by the programs. They are not PIDs copied from the PDF.

Baseline and delayed clients acknowledged all three messages and exited through their five-second idle timeout. Both servers remained alive after client exit, as recorded in `run.log`, and were then stopped by the harness. Their Node termination status was `code=null, signal=SIGTERM`. The two chaos servers were forcibly terminated, reporting `code=null, signal=SIGKILL`. A numeric server exit code was **not** reported by Node for these terminations; no Linux-style numeric exit code is inferred. All four experiment harness runs completed with exit code 0; each client's separate exit status is in the table.

Baseline sends occurred 256.946, 1268.855, and 2271.764 ms after the greeting. Delayed-run sends occurred 263.030, 1277.389, and 2292.116 ms after the greeting. These match the approximate 250 ms initial delay and one-second spacing, with scheduler variation.

Evidence is in `logs/<experiment>/server.log`, `client.log`, `run.log`, and `results.json`. `run.log` records port checks, starts, simultaneous liveness observations, termination actions, and exit results. Program logs contain the actual received/sent messages and RTT samples. No screenshots or synthetic output were produced.

## Baseline versus delayed RTT

The mean rose from **0.893 ms to 203.741 ms**, an increase of **202.848 ms**. There were only three samples per run, so this is a demonstration rather than a statistical benchmark.

RTT is measured with the client's monotonic `performance.now()` clock from immediately before logging/writing a request until its acknowledgment is parsed. It includes local logging/write overhead, TCP transport, server processing and scheduling, the intentional response delay, and client event-loop/parsing work. The 200 ms `setTimeout` increases server response time; it does not insert a 200 ms physical network delay. Timer scheduling explains why the observed increase need not be exactly 200.000 ms. These measurements do not isolate network-only or one-way latency.

## First observed distributed-process failure

The first runtime failure in the lab experiments was the deliberate server termination in the default chaos run.

1. Server PID **7912** acknowledged `hello-1`; client PID **41468** measured **202.545 ms** RTT.
2. At **2026-09-17T21:02:15.068Z**, the harness had observed that acknowledgment and recorded both processes alive.
3. At **21:02:15.170Z**, about **102 ms** later, it requested forced termination of server PID 7912 only.
4. The client printed **`socket error: ECONNRESET`**, followed by `hadError=true`, `acknowledged=1/3`, its single RTT sample, and `exit code=1`.
5. The harness recorded client exit code 1 at **21:02:15.192Z**. The server log ended after receiving `hello-1`; it had no opportunity to log normal disconnection. `hello-2` and `hello-3` were never sent.

Interpretation: the server process disappeared and its TCP connection was reset. The client was not killed by the harness. It executed its own socket error handler, canceled its send/hard/idle timers, printed its summary, and exited naturally with code 1. This is a partial failure of the two-process system. Independence does not mean the client must remain alive forever after losing its peer.

The custom-message run similarly received one acknowledgment for `custom payload with spaces`, then ECONNRESET and exit code 1. The harness correctly waited for that custom acknowledgment. A graceful remote end or another socket error would also be a valid observation on a different run or OS. The program treats normal closure as exit 0 and socket errors/hard timeout as exit 1; the acknowledgment count must also be inspected to decide whether all work completed.

## What the concepts mean here

- **Latency:** communicating and processing a reply takes measurable time. An added server delay increased observed RTT by about 203 ms.
- **Partial failure:** one process failed while the other was still executing. The connection failed and two intended messages were not exchanged.
- **Process independence:** each program had its own PID, event loop, timers, and memory. The server survived normal client exit. After server termination, the client ran its own error-handling and exit logic. Communication used TCP rather than shared JavaScript objects.

## Corrections and deviations from the PDF

- Used PowerShell plus a small shared Node harness because WSL lacked Node. The JavaScript needs no dependencies. Linux reproduction commands are documented but were not executed.
- Kept one server implementation with `ACK_DELAY_MS=0` or `200`, instead of editing the acknowledgment code between runs. Delayed-response timers belong to each connection and are canceled on end/close.
- Registered socket error handlers before greeting writes and added a listener-level error handler. Cleanup runs on `close`, including error-related closure, not just the normal `end` path.
- Used native socket idle timeouts and destroyed idle sockets so the five-second bound does not depend on a peer completing a half-close. The client retains the separate eight-second hard deadline.
- Used a monotonic, sub-millisecond clock for RTT instead of wall-clock `Date.now()`. All send and hard timers are canceled on closure; the client sets `process.exitCode` and exits naturally, preserving redirected errors and RTT summaries.
- Preserved message whitespace rather than trimming the payload. An optional CR before LF is removed for CRLF input. Custom client messages containing CR/LF are rejected so one argument represents one frame.
- Readiness comes from this server's listening log, after a bind-based free-port check. The harness does not add probe connections to the actual server, so the initial greeting counter is 1.
- Bounded waits fail explicitly instead of silently continuing after timeout. The chaos acknowledgment match adapts to custom messages. Log files are reset before each experiment, and stdout/stderr are both captured.
- Removed the PDF's broad `pkill -f` approach. Only child processes created by the current experiment are terminated. A busy port causes an abort rather than killing its owner.
- On Windows, the forced termination request is not a native POSIX SIGKILL. The report gives Node's observed termination status and the real ECONNRESET outcome instead of copying the PDF's sample normal exit.
- Corrected the PDF's statement that the delayed RTT represents network delay independent of Node/Linux: the artificial delay is in application code, and runtime/OS scheduling also contribute.

## Verification record

The main experiments directly verified the handshake, PID reporting, three-message timing, RTT reporting, idle closure, server survival, forced server failure, and custom-message path. Focused integration-check outcomes are recorded in `logs/verification.log`; its deliberately delayed test replies are separate from the baseline/delayed experiment data.

The initial focused test launch was blocked by the execution sandbox with `spawn EPERM`. This was an environment restriction, not a TCP failure. Its log is preserved in `logs/verification-first-attempt.log`, and the verification was rerun with permission outside the sandbox. This occurred after the first chaos experiment and is separate from the first distributed-process failure described above.

The approved verification run exited **0**, with all checks passing:

| Check | Actual result |
|---|---|
| Server split text and multiple newline frames | Correct echoes `fragmented`, `second`, `third`; counters 1–4 and server PID verified |
| Server idle connection | Five-second idle timeout and disconnect; listener then stopped by test cleanup |
| Client connection refusal | PID 22492; ECONNREFUSED, empty RTT list, exit 1 |
| Client split greeting/JSON and batched acknowledgments | PID 40896; all three acknowledgments parsed, remote FIN, exit 0 |
| Client idle server with no greeting | PID 29860; five-second idle timeout, empty RTT list, exit 0 |
| Client continuously receiving incomplete JSON | PID 38088; incoming bytes prevented idle timeout, eight-second hard timeout fired, exit 1 |

The no-greeting idle test also makes the exit-code convention explicit: exit 0 represents a handled idle/normal closure, not proof that all messages were acknowledged. The logs always report the acknowledgment count.

## Conclusion

The lab demonstrated the intended three properties with actual processes and logs. Server response delay raised RTT, forcibly terminating one process broke only its side of the application, and the other process executed its own handling before exiting. Windows produced a connection reset in the observed chaos runs; the result was recorded as observed.
