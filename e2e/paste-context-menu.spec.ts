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

  await nick.click({ button: "right" });

  // Menu label is "Paste" in en (CI runner default locale).
  await page.getByRole("menuitem", { name: "Paste" }).click();

  await expect(nick).toHaveValue("heXXXllo");
});
