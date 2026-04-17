import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, "..");

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
  });
  page = await electronApp.firstWindow();
  page.on("console", (msg) => {
    console.log(`[renderer ${msg.type()}]`, msg.text());
  });
  page.on("pageerror", (err) => {
    console.log(`[renderer pageerror]`, err.message);
  });
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await electronApp?.close();
});

test("right-click Paste inserts clipboard at caret, does not replace input", async () => {
  // The wizard's first step renders <Input id="nick" autoFocus>.
  const nick = page.locator("#nick");
  await nick.waitFor({ state: "visible", timeout: 30_000 });
  await nick.click();
  await nick.fill("hello");

  // Caret between "he" and "llo".
  await page.evaluate(() => {
    const el = document.getElementById("nick") as HTMLInputElement | null;
    el?.setSelectionRange(2, 2);
  });

  // Pre-fill the system clipboard via Electron's main-process clipboard module
  // — avoids any permission prompts that would block the renderer paste path.
  await electronApp.evaluate(({ clipboard }) => {
    clipboard.writeText("XXX");
  });

  // Probe: is the preload bridge present in the renderer?
  const bridgeProbe = await page.evaluate(() => {
    const w = globalThis as unknown as Record<string, unknown>;
    const sd = w.sicDesktop as Record<string, unknown> | undefined;
    const cb = sd ? (sd.clipboard as Record<string, unknown> | undefined) : undefined;
    const rt = cb ? (cb.readText as (() => string) | undefined) : undefined;
    let readNow: string | null = null;
    let readErr: string | null = null;
    if (typeof rt === "function") {
      try { readNow = rt(); } catch (e) { readErr = String(e); }
    }
    return {
      hasSicDesktop: !!sd,
      hasClipboard: !!cb,
      canRead: typeof rt === "function",
      readNow,
      readErr,
    };
  });
  console.log("[bridge probe]", JSON.stringify(bridgeProbe));

  await nick.click({ button: "right" });

  // Wait for the menu to actually appear before clicking Paste.
  await page.locator('[role="menu"]').waitFor({ state: "visible", timeout: 5_000 });
  const menuItems = await page.locator('[role="menuitem"]').allTextContents();
  console.log("[menu items]", JSON.stringify(menuItems));

  await page.getByRole("menuitem", { name: "Paste", exact: true }).click();

  // Give the async readClipboard().then(doPaste) microtask + RAF chain time to land.
  await page.waitForTimeout(500);
  const probe = await page.evaluate(() => {
    const el = document.getElementById("nick") as HTMLInputElement | null;
    return { value: el?.value ?? null, activeId: document.activeElement?.id ?? null };
  });
  console.log("[post-paste probe]", JSON.stringify(probe));

  await expect(nick).toHaveValue("heXXXllo");
});
