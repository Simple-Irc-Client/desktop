// CI smoke test for the packaged app: `node scripts/smoke-test.js <path-to-binary>`.
//
// The binary runs with SMOKE_TEST=1, prints SMOKE_TEST_READY once the webview has loaded and exits 0;
// a panic prints SMOKE_TEST_ERROR (see src-tauri/src/lib.rs). Pass/fail is decided by these sentinels
// only, because WebKitGTK, Wayland and D-Bus log plenty of harmless "error" noise in CI.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Cold start on a CI runner, especially Windows, can be slow
const TIMEOUT_MS = 60_000;

const READY_SENTINEL = "SMOKE_TEST_READY";
const ERROR_SENTINEL = "SMOKE_TEST_ERROR";

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

const child = spawn(binaryPath, [], {
  env: { ...process.env, SMOKE_TEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

// Dumped only on failure; on success the output was already streamed through
let capturedStdout = "";
let capturedStderr = "";
let sawReady = false;
let sawError = false;
let finished = false;

const timer = setTimeout(() => {
  finish(1, `timeout after ${TIMEOUT_MS}ms without ${READY_SENTINEL}`);
}, TIMEOUT_MS);

/** First call decides the result; the error sentinel, the close event and the timeout can all race here. */
function finish(code, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);

  // On success the app is already exiting; this only guards against a hung process
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
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

child.stdout.on("data", (buf) => {
  const chunk = buf.toString();
  capturedStdout += chunk;
  process.stdout.write(chunk);
  if (chunk.includes(READY_SENTINEL)) {
    sawReady = true;
  }
});

child.stderr.on("data", (buf) => {
  const chunk = buf.toString();
  capturedStderr += chunk;
  process.stderr.write(chunk);
  if (!sawError && chunk.includes(ERROR_SENTINEL)) {
    sawError = true;
    finish(1, `main process reported ${ERROR_SENTINEL}`);
  }
});

child.on("error", (err) => {
  finish(1, `failed to spawn: ${err.message}`);
});

// 'close' rather than 'exit': stdout is fully flushed by then, so a ready sentinel in the last chunk isn't missed
child.on("close", (code, signal) => {
  if (sawError) return;

  if (!sawReady) {
    finish(1, `exited before ${READY_SENTINEL}: code=${code} signal=${signal}`);
  } else if (code === 0 || signal === "SIGKILL") {
    finish(0, `saw ${READY_SENTINEL} and exited cleanly`);
  } else {
    finish(1, `saw ${READY_SENTINEL} but exited with code=${code} signal=${signal}`);
  }
});
