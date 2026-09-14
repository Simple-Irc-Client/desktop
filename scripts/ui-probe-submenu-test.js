// TEMPORARY — best-effort macOS repro harness for a DropdownMenuSub bug: a
// submenu (e.g. "Akcje operatora" in the user context menu) can close right
// after opening even though the pointer never left it. See the submenu-guard
// breadcrumbs in core's src/shared/components/ui/dropdown-menu.tsx and the
// Sentry diagnostics they feed — this script exists because that bug has
// only been observed on a real macOS/WKWebView build, and jsdom/Chromium
// can't reproduce whatever WKWebView is doing to its own pointer-event
// delivery.
//
// How it works:
//   1. Spawn the packaged macOS binary with UI_PROBE_TEST=1. The Tauri shell
//      (src-tauri/src/lib.rs) renders core's UiProbeSubmenuPage instead of
//      the normal app, and prints the window's real on-screen content-area
//      origin (UI_PROBE_READY) once the page has loaded.
//   2. The probe page itself reports the submenu trigger's on-screen
//      rectangle (UI_PROBE_EVENT: trigger-rect ...) and every open/close
//      transition of the submenu (UI_PROBE_EVENT: sub opened/closed ...) —
//      all via a Tauri command that prints to this process's stdout, since
//      that's the only channel back out of the webview we already have
//      wired (mirrors scripts/smoke-test.js's sentinel pattern).
//   3. Once both geometry sentinels are in, this script drives the REAL OS
//      pointer (via `cliclick`, not a synthetic DOM event — synthetic events
//      bypass exactly the layer under suspicion) to the trigger's centre and
//      leaves it parked there, then watches for a close event.
//   4. Verdict is informational only. This never fails the build: a script
//      built for a best-effort repro attempt isn't a correctness gate, and a
//      miss here says nothing about whether the bug still exists.
//
// Delete this file, the two Rust commands it depends on, core's
// src/UiProbeSubmenuPage.tsx and its wiring in index.tsx, and the workflow
// that calls this script once the bug is diagnosed or ruled out.

import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const READY_RE = /UI_PROBE_READY x=(-?\d+) y=(-?\d+) scale=([\d.]+)/;
const RECT_RE = /UI_PROBE_EVENT: trigger-rect x=([\d.-]+) y=([\d.-]+) width=([\d.-]+) height=([\d.-]+)/;
const OPENED_RE = /UI_PROBE_EVENT: sub opened at (\d+)/;
const CLOSED_RE = /UI_PROBE_EVENT: sub closed at (\d+) msOpen=(-?\d+)/;

// Generous — a first run on a fresh CI runner (unsigned debug binary, cold
// WKWebView init, no bundle metadata) got nowhere near any of the Rust-side
// checkpoints within 45s, so this leaves real headroom rather than guessing
// at a tighter number. Cold start plus the settle delay the probe page
// itself waits before reporting its trigger rect, plus our own
// hover-and-observe window.
const OVERALL_TIMEOUT_MS = 90_000;
// How long to leave the pointer parked on the trigger, doing nothing else,
// once it has opened. The original bug report described a close within
// ~150-200ms of opening; this is generous headroom above that.
const OBSERVE_MS = 8_000;

const binaryArg = process.argv[2];
if (!binaryArg) {
  console.error("Usage: node scripts/ui-probe-submenu-test.js <path-to-binary>");
  process.exit(2);
}
const binaryPath = resolve(binaryArg);
if (!existsSync(binaryPath)) {
  console.error(`Binary not found: ${binaryPath}`);
  process.exit(2);
}

if (process.platform !== "darwin") {
  console.log("This probe only makes sense on macOS (real WKWebView) — skipping.");
  process.exit(0);
}

try {
  execFileSync("cliclick", ["-V"], { stdio: "ignore" });
} catch {
  console.error(
    "cliclick not found. Install it first (`brew install cliclick`) — " +
      "it drives the real OS pointer, which is the whole point of this probe."
  );
  process.exit(2);
}

console.log(`UI probe: launching ${binaryPath}`);

const child = spawn(binaryPath, [], {
  env: { ...process.env, UI_PROBE_TEST: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let finished = false;
let windowOrigin = null; // { x, y, scale } — physical pixels, content-area origin
let triggerRect = null; // { x, y, width, height } — CSS px, webview-local
let hoveredAt = null;
let sawOpen = false;
let sawClose = false;
let closeInfo = null;

const overallTimer = setTimeout(() => finish("timeout"), OVERALL_TIMEOUT_MS);

function finish(reason) {
  if (finished) return;
  finished = true;
  clearTimeout(overallTimer);
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }

  console.log("\n=== UI probe result ===");
  console.log(`reason: ${reason}`);
  console.log(`window origin: ${windowOrigin ? JSON.stringify(windowOrigin) : "never observed"}`);
  console.log(`trigger rect:  ${triggerRect ? JSON.stringify(triggerRect) : "never observed"}`);
  console.log(`hovered at:    ${hoveredAt ? new Date(hoveredAt).toISOString() : "never hovered"}`);
  console.log(`submenu opened: ${sawOpen}`);
  console.log(`submenu closed while parked on it: ${sawClose}`);
  if (sawClose) {
    console.log(`  -> ${JSON.stringify(closeInfo)}`);
    console.log(
      "  -> REPRODUCED: the submenu closed on its own while the pointer never moved off it. " +
        "This is the bug — see the breadcrumb trail above for which path closed it."
    );
  } else if (sawOpen) {
    console.log(`  -> did not reproduce this run: stayed open for the full ${OBSERVE_MS}ms observation window.`);
  } else {
    console.log("  -> inconclusive: the submenu never registered as open (hover-open itself may need retuning).");
  }
  console.log("=== end UI probe result ===\n");

  // Always exit 0 — see the file header. This is a diagnostic tool, not a gate.
  process.exit(0);
}

function maybeStartHover() {
  if (hoveredAt !== null || !windowOrigin || !triggerRect) return;

  const centerXLogical = windowOrigin.x / windowOrigin.scale + triggerRect.x + triggerRect.width / 2;
  const centerYLogical = windowOrigin.y / windowOrigin.scale + triggerRect.y + triggerRect.height / 2;
  const x = Math.round(centerXLogical);
  const y = Math.round(centerYLogical);

  console.log(`UI probe: moving pointer to (${x}, ${y}) and parking it there`);
  hoveredAt = Date.now();
  try {
    execFileSync("cliclick", [`m:${x},${y}`]);
  } catch (err) {
    finish(`cliclick move failed: ${err.message}`);
    return;
  }

  // Nudge by one pixel and back — some hover-intent implementations key off
  // a genuine pointermove delta, not just cursor presence, to open the
  // submenu in the first place.
  try {
    execFileSync("cliclick", [`m:${x + 1},${y}`]);
    execFileSync("cliclick", [`m:${x},${y}`]);
  } catch {
    // best effort — the plain move above already landed
  }

  setTimeout(() => finish("observation window elapsed"), OBSERVE_MS);
}

child.stdout.on("data", (buf) => {
  const chunk = buf.toString();
  process.stdout.write(chunk);

  for (const line of chunk.split("\n")) {
    const ready = READY_RE.exec(line);
    if (ready) {
      windowOrigin = { x: Number(ready[1]), y: Number(ready[2]), scale: Number(ready[3]) };
      maybeStartHover();
      continue;
    }
    const rect = RECT_RE.exec(line);
    if (rect) {
      triggerRect = {
        x: Number(rect[1]),
        y: Number(rect[2]),
        width: Number(rect[3]),
        height: Number(rect[4]),
      };
      maybeStartHover();
      continue;
    }
    if (OPENED_RE.exec(line)) {
      sawOpen = true;
      continue;
    }
    const closed = CLOSED_RE.exec(line);
    if (closed && hoveredAt !== null) {
      sawClose = true;
      closeInfo = { closedAtMs: Number(closed[1]), msOpen: Number(closed[2]) };
      finish("submenu closed while pointer was parked on it");
    }
  }
});

child.stderr.on("data", (buf) => process.stderr.write(buf));

child.on("error", (err) => finish(`failed to spawn: ${err.message}`));
child.on("close", (code, signal) => {
  if (!finished) finish(`process exited early: code=${code} signal=${signal}`);
});
