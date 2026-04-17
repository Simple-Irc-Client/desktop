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
  page.on("console", (msg) => { console.log(`[renderer ${msg.type()}]`, msg.text()); });
  page.on("pageerror", (err) => { console.log(`[renderer pageerror]`, err.message); });
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await electronApp?.close();
});

test("right-click Paste inserts clipboard at caret, does not replace input", async () => {
  // Wizard's first step renders <Input id="nick" autoFocus>.
  const nick = page.locator("#nick");
  await nick.waitFor({ state: "visible", timeout: 30_000 });
  await nick.click();
  await nick.fill("hello");

  await page.evaluate(() => {
    const el = document.getElementById("nick") as HTMLInputElement | null;
    el?.setSelectionRange(2, 2);
  });

  // Pre-fill the system clipboard from the main process to avoid any
  // renderer permission prompts.
  await electronApp.evaluate(({ clipboard }) => { clipboard.writeText("XXX"); });

  await nick.click({ button: "right" });
  await page.locator('[role="menu"]').waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("menuitem", { name: "Paste", exact: true }).click();

  await expect(nick).toHaveValue("heXXXllo");
});
