import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TIMEOUT_MS = 60_000;
const READY_SENTINEL = "SMOKE_TEST_READY";
const ERROR_SENTINEL = "SMOKE_TEST_ERROR";

const binary = process.argv[2];
if (!binary) {
  console.error("Usage: node scripts/smoke-test.js <path-to-binary>");
  process.exit(2);
}

const binaryPath = resolve(binary);
if (!existsSync(binaryPath)) {
  console.error(`Binary not found: ${binaryPath}`);
  process.exit(2);
}

console.log(`Smoke testing: ${binaryPath}`);

const child = spawn(binaryPath, [], {
  env: { ...process.env, SMOKE_TEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let sawReady = false;
let sawError = false;
let finished = false;

const timer = setTimeout(() => {
  finish(1, `timeout after ${TIMEOUT_MS}ms without ${READY_SENTINEL}`);
}, TIMEOUT_MS);

function finish(code, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  try {
    child.kill("SIGKILL");
  } catch {}
  if (code === 0) {
    console.log(`Smoke test PASSED (${reason})`);
    process.exit(0);
  } else {
    console.error(`Smoke test FAILED: ${reason}`);
    if (stdout) console.error("--- captured stdout ---\n" + stdout);
    if (stderr) console.error("--- captured stderr ---\n" + stderr);
    process.exit(1);
  }
}

child.stdout.on("data", (buf) => {
  const s = buf.toString();
  stdout += s;
  process.stdout.write(s);
  if (!sawReady && s.includes(READY_SENTINEL)) {
    sawReady = true;
  }
});

child.stderr.on("data", (buf) => {
  const s = buf.toString();
  stderr += s;
  process.stderr.write(s);
  if (!sawError && s.includes(ERROR_SENTINEL)) {
    sawError = true;
    finish(1, `main process reported ${ERROR_SENTINEL}`);
  }
});

child.on("error", (err) => {
  finish(1, `failed to spawn: ${err.message}`);
});

child.on("close", (code, signal) => {
  if (sawError) return;
  if (sawReady && (code === 0 || signal === "SIGKILL")) {
    finish(0, `saw ${READY_SENTINEL} and exited cleanly`);
  } else if (sawReady) {
    finish(1, `saw ${READY_SENTINEL} but exited with code=${code} signal=${signal}`);
  } else {
    finish(1, `exited before ${READY_SENTINEL}: code=${code} signal=${signal}`);
  }
});
