// CI smoke test for the packaged Tauri app.
//
// Modes (selected via --mode=, default "ready"):
//   ready  — verify the webview reaches first page load and exits cleanly.
//   paste  — drive a Tauri-side round-trip of the custom context-menu Paste
//            action (used on macOS, where tauri-driver can't drive WKWebView;
//            Linux/Windows use the WebDriver-based test in desktop/e2e/).
//            THROWAWAY: remove the paste branch here and in src-tauri/src/lib.rs
//            once the Electron → Tauri migration verification window closes.
//
// How it works:
//   1. Spawn the packaged binary with SMOKE_TEST=<env> in the environment
//      (ready → "1", paste → "paste"). The Tauri shell (src-tauri/src/lib.rs)
//      reads that flag and switches to the matching test harness, plus
//      installs a panic hook that prints SMOKE_TEST_ERROR on stderr.
//   2. This runner watches the child's output. It passes if and only if
//      the mode's success sentinel was observed AND the process closed cleanly.
//   3. Any of the following count as a failure: an error sentinel on
//      stderr, a non-zero exit, an exit before the success sentinel,
//      a failed spawn, or an overall timeout.
//
// The protocol is line-based sentinels rather than regex-matching on
// stderr because WebKitGTK / Wayland / D-Bus produce a lot of noisy
// warnings under CI that are NOT failures — matching on "error" or "fatal"
// would cause false positives.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Upper bound on how long we'll wait for the app to reach the success
// sentinel. Cold-start on a CI runner (especially Windows) can be slow,
// so this is intentionally generous. Paste mode does more renderer-side
// work after page load, so it gets the longer budget.
const TIMEOUTS = {
  ready: 60_000,
  paste: 90_000,
};

// Sentinels exchanged with the instrumented Tauri shell.
// Keep these in sync with src-tauri/src/lib.rs.
const READY_SENTINEL = "SMOKE_TEST_READY";
const ERROR_SENTINEL = "SMOKE_TEST_ERROR";
const PASTE_OK_PREFIX = "SMOKE_TEST_PASTE_OK";
const PASTE_FAIL_PREFIX = "SMOKE_TEST_PASTE_FAIL";

// ---------- argument parsing ----------

const args = process.argv.slice(2);
let mode = "ready";
let binaryArg;
for (const arg of args) {
  if (arg.startsWith("--mode=")) {
    mode = arg.slice("--mode=".length);
  } else if (!binaryArg) {
    binaryArg = arg;
  } else {
    console.error(`Unexpected extra argument: ${arg}`);
    process.exit(2);
  }
}
if (!binaryArg) {
  console.error("Usage: node scripts/smoke-test.js [--mode=ready|paste] <path-to-binary>");
  process.exit(2);
}
if (mode !== "ready" && mode !== "paste") {
  console.error(`Unknown --mode=${mode}; expected "ready" or "paste"`);
  process.exit(2);
}

const binaryPath = resolve(binaryArg);
if (!existsSync(binaryPath)) {
  console.error(`Binary not found: ${binaryPath}`);
  process.exit(2);
}

console.log(`Smoke testing (mode=${mode}): ${binaryPath}`);

// ---------- spawn the app ----------

// Flip lib.rs into the matching test harness. stdin is ignored because the
// app doesn't read from it; stdout/stderr are piped so we can stream them
// through and scan for sentinels at the same time.
const smokeEnvValue = mode === "paste" ? "paste" : "1";
const child = spawn(binaryPath, [], {
  env: { ...process.env, SMOKE_TEST: smokeEnvValue },
  stdio: ["ignore", "pipe", "pipe"],
});

// ---------- runner state ----------

// Full captures are kept so we can dump them on failure. On success we
// stay quiet (the child's output has already been streamed to our
// stdout/stderr by the data handlers below).
let capturedStdout = "";
let capturedStderr = "";

// Whether we've seen each sentinel. sawReady gates ready-mode pass/fail at
// close time; sawError lets us fail fast without waiting for the child to
// exit. In paste mode, sawReady is informational only — the verdict comes
// from the paste sentinels.
let sawReady = false;
let sawError = false;
let pasteVerdict = null; // null | { ok: true, line } | { ok: false, line }

// Guard so finish() is idempotent. Multiple code paths can race to end
// the test (stderr sentinel, close event, timeout) and without this we'd
// log contradictory results or call process.exit() twice.
let finished = false;

// ---------- timeout ----------

const timeoutMs = TIMEOUTS[mode];
const timeoutReason = mode === "paste"
  ? `timeout after ${timeoutMs}ms without ${PASTE_OK_PREFIX}/${PASTE_FAIL_PREFIX}`
  : `timeout after ${timeoutMs}ms without ${READY_SENTINEL}`;
const timer = setTimeout(() => {
  finish(1, timeoutReason);
}, timeoutMs);

// ---------- completion ----------

/**
 * End the smoke test. First caller wins; subsequent callers are no-ops.
 * Always kills the child (it may still be alive on the success path
 * because the success sentinel arrives before the app has fully quit).
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

// Extract the first line in `chunk` that starts with `prefix`, returning the
// full line (without trailing newline). This lets us surface the token /
// failure reason in the runner output rather than just the prefix.
function findSentinelLine(chunk, prefix) {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line;
  }
  return null;
}

// Stream stdout through and watch for the mode's sentinels. We don't
// finish() on sawReady alone in ready mode — we wait for the close event
// so the pass/fail decision also accounts for the final exit code. Paste
// mode is allowed to finish() as soon as the verdict line arrives, since
// the verdict itself is the result we care about (the subsequent exit is
// driven by the Rust side and serves only as cleanup).
child.stdout.on("data", (buf) => {
  const chunk = buf.toString();
  capturedStdout += chunk;
  process.stdout.write(chunk);
  if (!sawReady && chunk.includes(READY_SENTINEL)) {
    sawReady = true;
  }
  if (mode === "paste" && pasteVerdict === null) {
    const okLine = findSentinelLine(chunk, PASTE_OK_PREFIX);
    if (okLine) {
      pasteVerdict = { ok: true, line: okLine };
    } else {
      const failLine = findSentinelLine(chunk, PASTE_FAIL_PREFIX);
      if (failLine) {
        pasteVerdict = { ok: false, line: failLine };
        finish(1, `paste round-trip reported failure: ${failLine}`);
      }
    }
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
// success sentinel if it arrived in the very last chunk.
child.on("close", (code, signal) => {
  // stderr sentinel / paste failure already called finish(); don't overwrite.
  if (sawError) return;
  if (pasteVerdict && !pasteVerdict.ok) return;

  if (mode === "paste") {
    if (pasteVerdict?.ok && (code === 0 || signal === "SIGKILL")) {
      finish(0, `saw ${pasteVerdict.line} and exited cleanly`);
      return;
    }
    if (pasteVerdict?.ok) {
      finish(1, `saw ${pasteVerdict.line} but exited with code=${code} signal=${signal}`);
      return;
    }
    finish(1, `exited before paste verdict: code=${code} signal=${signal}`);
    return;
  }

  // ready mode — happy path: we saw the ready sentinel, and the process
  // either exited 0 on its own (app.exit(0) from the instrumented shell)
  // or was killed by our own SIGKILL after finish() ran.
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
