// CI smoke test for the packaged Tauri app.
//
// How it works:
//   1. Spawn the packaged binary with SMOKE_TEST=1 in the environment.
//   2. The Tauri shell (src-tauri/src/lib.rs) sees that flag and installs
//      a panic hook that prints SMOKE_TEST_ERROR on stderr, plus a page-load
//      callback that prints SMOKE_TEST_READY on stdout once the webview's
//      first navigation finishes, then cleanly exits 0.
//   3. This runner watches the child's output. It passes if and only if
//      the ready sentinel was observed AND the process closed cleanly.
//   4. Any of the following count as a failure: an error sentinel on
//      stderr, a non-zero exit, an exit before the ready sentinel,
//      a failed spawn, or an overall timeout.
//
// The protocol is line-based sentinels rather than regex-matching on
// stderr because WebKitGTK / Wayland / D-Bus produce a lot of noisy
// warnings under CI that are NOT failures — matching on "error" or "fatal"
// would cause false positives.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Upper bound on how long we'll wait for the app to reach the ready
// sentinel. Cold-start on a CI runner (especially Windows) can be slow,
// so this is intentionally generous.
const TIMEOUT_MS = 60_000;

// Sentinels exchanged with the instrumented Tauri shell.
// Keep these in sync with src-tauri/src/lib.rs.
const READY_SENTINEL = "SMOKE_TEST_READY";
const ERROR_SENTINEL = "SMOKE_TEST_ERROR";

// ---------- argument parsing ----------

const binaryArg = process.argv[2];
if (!binaryArg) {
  console.error("Usage: node scripts/smoke-test.js <path-to-binary>");
  process.exit(2);
}

const binaryPath = resolve(binaryArg);
if (!existsSync(binaryPath)) {
  console.error(`Binary not found: ${binaryPath}`);
  process.exit(2);
}

console.log(`Smoke testing: ${binaryPath}`);

// ---------- spawn the app ----------

// SMOKE_TEST=1 flips lib.rs into test mode. stdin is ignored because the
// app doesn't read from it; stdout/stderr are piped so we can stream them
// through and scan for sentinels at the same time.
const child = spawn(binaryPath, [], {
  env: { ...process.env, SMOKE_TEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

// ---------- runner state ----------

// Full captures are kept so we can dump them on failure. On success we
// stay quiet (the child's output has already been streamed to our
// stdout/stderr by the data handlers below).
let capturedStdout = "";
let capturedStderr = "";

// Whether we've seen each sentinel. sawReady decides pass/fail at close
// time; sawError lets us fail fast without waiting for the child to exit.
let sawReady = false;
let sawError = false;

// Guard so finish() is idempotent. Multiple code paths can race to end
// the test (stderr sentinel, close event, timeout) and without this we'd
// log contradictory results or call process.exit() twice.
let finished = false;

// ---------- timeout ----------

const timer = setTimeout(() => {
  finish(1, `timeout after ${TIMEOUT_MS}ms without ${READY_SENTINEL}`);
}, TIMEOUT_MS);

// ---------- completion ----------

/**
 * End the smoke test. First caller wins; subsequent callers are no-ops.
 * Always kills the child (it may still be alive on the success path
 * because the ready sentinel arrives before the app has fully quit).
 */
function finish(code, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);

  // SIGKILL is deliberate: we don't need a graceful shutdown, and on the
  // success path the Tauri app has already called app_handle.exit(0) —
  // this is just insurance against a hung process.
  try {
    child.kill("SIGKILL");
  } catch {
    // Child may already be gone; that's fine.
  }

  if (code === 0) {
    console.log(`Smoke test PASSED (${reason})`);
    process.exit(0);
  }

  console.error(`Smoke test FAILED: ${reason}`);
  if (capturedStdout) console.error("--- captured stdout ---\n" + capturedStdout);
  if (capturedStderr) console.error("--- captured stderr ---\n" + capturedStderr);
  process.exit(1);
}

// ---------- child output handlers ----------

// Stream stdout through and watch for the ready sentinel. We don't
// finish() here even after seeing it — we wait for the close event so
// the pass/fail decision also accounts for the final exit code.
child.stdout.on("data", (buf) => {
  const chunk = buf.toString();
  capturedStdout += chunk;
  process.stdout.write(chunk);
  if (!sawReady && chunk.includes(READY_SENTINEL)) {
    sawReady = true;
  }
});

// Stream stderr through and fail fast if the Tauri shell reports an
// error sentinel. That path fires from the panic hook installed in
// src-tauri/src/lib.rs, so it's always a real bug worth surfacing
// immediately.
child.stderr.on("data", (buf) => {
  const chunk = buf.toString();
  capturedStderr += chunk;
  process.stderr.write(chunk);
  if (!sawError && chunk.includes(ERROR_SENTINEL)) {
    sawError = true;
    finish(1, `main process reported ${ERROR_SENTINEL}`);
  }
});

// ---------- child lifecycle ----------

// Fires when spawn itself fails (binary not executable, bad arch, etc.).
child.on("error", (err) => {
  finish(1, `failed to spawn: ${err.message}`);
});

// 'close' (not 'exit') is used so that stdout/stderr are fully flushed
// before we make the pass/fail decision. Otherwise we could miss the
// ready sentinel if it arrived in the very last chunk.
child.on("close", (code, signal) => {
  // stderr sentinel already called finish(); don't overwrite its verdict.
  if (sawError) return;

  // Happy path: we saw the ready sentinel, and the process either exited
  // 0 on its own (app.exit(0) from the instrumented shell) or was killed
  // by our own SIGKILL after finish() ran.
  if (sawReady && (code === 0 || signal === "SIGKILL")) {
    finish(0, `saw ${READY_SENTINEL} and exited cleanly`);
    return;
  }

  // Ready sentinel was observed but the process then died with a bad
  // exit — treat as a failure so post-ready crashes don't slip through.
  if (sawReady) {
    finish(1, `saw ${READY_SENTINEL} but exited with code=${code} signal=${signal}`);
    return;
  }

  // Process ended before we ever saw the ready sentinel: shell crash
  // during startup, missing system library, webview failed to load, etc.
  finish(1, `exited before ${READY_SENTINEL}: code=${code} signal=${signal}`);
});
