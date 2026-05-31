// THROWAWAY: see desktop/e2e/wdio.conf.cjs for context.
//
// Verifies that pasting via the custom React context menu round-trips a token
// through the system clipboard inside the real Tauri webview:
//
//   1. Wait for the wizard nick input (#nick) — the wizard renders first on
//      a clean install so we don't need to drive through the connect flow.
//   2. Seed the OS clipboard with a unique token via the same plugin command
//      (`plugin:clipboard-manager|write_text`) that the production paste path
//      reads from in `runtime/desktop.ts`. Using the plugin (not xclip /
//      pbcopy / clip) keeps the test platform-independent and exercises the
//      write half symmetrically.
//   3. Right-click the input via WebDriver's native pointer action — this is
//      the path that fires `mousedown button=2` + the bubbled `contextmenu`
//      event the way the real renderer would see them, including the macOS
//      auto-select interaction GlobalInputContextMenu specifically works
//      around (see savedSelectionRef in GlobalInputContextMenu.tsx).
//   4. Click the third menuitem — items render Cut / Copy / Paste / Select
//      All in fixed DOM order, so position-based lookup avoids depending on
//      the browser UI locale (i18n could otherwise resolve to "Wklej").
//   5. Wait for the controlled input's `.value` to equal the seeded token.
//      That's the assertion: the Tauri-side clipboard read fed our React
//      paste handler and `execCommand('insertText')` updated the input.

describe('Tauri custom context menu — Paste round-trip', () => {
  it('writes a token via the clipboard plugin, right-clicks #nick, clicks Paste, asserts input value', async () => {
    const input = await $('#nick');
    await input.waitForExist({ timeout: 30_000 });

    const token = `wdio-paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const seedError = await browser.executeAsync((value, done) => {
      window.__TAURI_INTERNALS__
        .invoke('plugin:clipboard-manager|write_text', { label: null, text: value })
        .then(() => done(null), (err) => done(String(err && err.message ? err.message : err)));
    }, token);
    if (seedError) throw new Error(`clipboard-manager|write_text failed: ${seedError}`);

    await input.click();
    await input.click({ button: 'right' });

    await browser.waitUntil(
      async () => (await $$('[role="menuitem"]')).length >= 3,
      { timeout: 5_000, timeoutMsg: 'custom context menu never rendered 3+ menuitems' },
    );
    const items = await $$('[role="menuitem"]');
    await items[2].click();

    await browser.waitUntil(
      async () => (await input.getValue()) === token,
      {
        timeout: 5_000,
        timeoutMsg: `#nick.value never reached the seeded token "${token}"`,
      },
    );
  });
});
