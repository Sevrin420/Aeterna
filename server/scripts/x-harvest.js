#!/usr/bin/env node
/**
 * Print a snippet to paste into your browser's console on an X post, which
 * reads the replies YOU are already logged in to see and hands back the list
 * of handles that wrote the phrase.
 *
 *   node scripts/x-harvest.js            # print the snippet
 *   node scripts/x-harvest.js --copy     # print it bare, ready to select
 *
 * WHY THIS INSTEAD OF THE API
 *
 * The API route for reading replies is recent-search, which reaches seven days
 * and is not on the free tier. This needs neither. It is your own browser, on a
 * page you have open, reading what is already rendered to you — the script does
 * the transcribing so you do not have to copy forty handles by hand.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not log in, click, post, follow, or open pages by itself. You open
 * the post and you scroll it; the collector only watches what appears. That
 * distinction matters: automating an account is a different thing from reading
 * a page you are looking at, and this is deliberately only the second.
 *
 * THE ONE THING TO KNOW
 *
 * X virtualises the reply list — rows are DESTROYED as they scroll out of
 * view. A single pass over the DOM therefore captures only what is on screen
 * at that instant, which is why a naive one-shot scrape silently under-pays.
 * The collector below keeps a running Set and re-harvests on every mutation,
 * so you scroll to the bottom and it accumulates. It tells you the count as it
 * goes so you can see it climbing rather than guess.
 */

const SNIPPET = String.raw`
(() => {
  const PHRASE = 'Sanguis Aeternus, Vita Aeterna';
  const norm = (v) => String(v || '').toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const WANT = norm(PHRASE);

  const found = new Map();   // handle -> the text that earned it
  let seen = 0;

  function harvest() {
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      seen++;
      const textEl = art.querySelector('[data-testid="tweetText"]');
      if (!textEl) continue;
      if (!norm(textEl.innerText).includes(WANT)) continue;
      // The handle is the only @-link in the row's author block.
      const link = [...art.querySelectorAll('a[href^="/"]')]
        .map((a) => a.getAttribute('href'))
        .find((h) => /^\/[A-Za-z0-9_]{1,15}$/.test(h));
      if (!link) continue;
      const handle = link.slice(1);
      if (!found.has(handle)) {
        found.set(handle, textEl.innerText.replace(/\s+/g, ' ').slice(0, 60));
        console.log('%c+ @' + handle, 'color:#7ec850', '—', found.get(handle));
      }
    }
    box.textContent = found.size + ' found · keep scrolling · ' + seen + ' rows seen';
  }

  // a small readout pinned to the corner so you can watch it climb
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:99999;right:12px;bottom:12px;background:#0a090c;' +
    'color:#e8e2c8;font:13px/1.4 monospace;padding:10px 12px;border:1px solid #615e72;border-radius:4px';
  document.body.appendChild(box);

  // The observer watches the whole body, and harvest() writes the count into
  // the readout — which is itself a mutation inside that body. Wired naively
  // that is an infinite loop that pegs the tab: observe, write, observe. So
  // mutations originating inside the readout are ignored, and the harvest is
  // throttled to one run per frame however many rows X inserts at once.
  let pending = false;
  const obs = new MutationObserver((records) => {
    if (records.every((r) => box === r.target || box.contains(r.target))) return;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; harvest(); });
  });
  obs.observe(document.body, { childList: true, subtree: true });
  harvest();

  window.aeternaDone = () => {
    obs.disconnect();
    const handles = [...found.keys()];
    const out = handles.map((h) => '@' + h).join(',');
    console.log('%c' + found.size + ' handle(s) wrote the phrase:', 'color:#f2d264;font-size:14px');
    console.log(out);
    box.textContent = 'done — ' + found.size + ' handles (copied to clipboard if allowed)';
    try { navigator.clipboard.writeText(out); } catch (e) {}
    return out;
  };
  console.log('%cAeterna collector armed. Scroll the replies to the bottom, then run: aeternaDone()',
    'color:#f2d264;font-size:14px');
})();
`.trim();

if (process.argv.includes('--copy')) {
  console.log(SNIPPET);
  process.exit(0);
}

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  Harvest the phrase from an X post — no API, no token            ║
╚══════════════════════════════════════════════════════════════════╝

 1. Open the post in your browser and switch to the replies.
 2. Open the console  (F12, or Cmd-Opt-J / Ctrl-Shift-J).
 3. Paste the snippet below and press Enter.
 4. SCROLL the replies all the way down. X destroys rows as they
    leave the screen, so the collector has to see them go past —
    the counter in the corner climbs as it finds them.
 5. Run:  aeternaDone()
    It prints the handles and copies them to your clipboard.
 6. Pay them:

      node scripts/x-scan.js --post <post-url> --handles <paste>

    That applies the Bloodline requirement and the once-per-post
    ledger, so re-running it pays nobody twice.

─────────────────────────── snippet ────────────────────────────────

${SNIPPET}

────────────────────────────────────────────────────────────────────
 Tip:  node scripts/x-harvest.js --copy | pbcopy      (mac)
       node scripts/x-harvest.js --copy | xclip -sel c (linux)
`);
