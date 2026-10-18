#!/usr/bin/env node
/* ==========================================================================
   LethalPath a11y check — a browser-measured accessibility audit for the
   static site (site/*.html), loaded from file:// URLs.

   CI note: if playwright-core cannot be resolved or no chromium binary can
   be launched, this checker prints a "SKIPPED — needs playwright-core and a
   chromium binary" notice (listing every resolution attempt it made) and
   exits 0, so a dependency-free CI can still run it.

   Per page, all findings are collected (nothing short-circuits) and the exit
   code is 1 when any FAIL-level finding exists:
     1. landmarks  — header / nav / main / footer; exactly one h1; heading
                     levels never skip (h1 -> h3 without h2).
     2. names      — every a[href], button, input, select, textarea has a
                     non-empty accessible name (text, aria-label/-labelledby,
                     label, title); every img has alt (empty is fine); SVGs
                     that are not aria-hidden must carry a label (role=img
                     without a name fails); decorative SVGs missing
                     aria-hidden are WARNs.
     3. keyboard   — real Tab traversal (up to 200 stops) from the body:
                     every visible interactive element must be reachable, and
                     each focused element must change its computed outline /
                     box-shadow / background / border / transform versus its
                     unfocused state, else the focus indicator is invisible.
                     Content hidden via content-visibility (e.g. the inside of
                     a closed <details> in current chromium) or [inert] is not
                     counted as a visible control. For a skip link: the
                     bounding box and computed transform are sampled before
                     focus, immediately after a real Tab press, and again after
                     its CSS transition settles; it must end fully visible, and
                     the Enter-activation target (#id) must exist. Focus-ring
                     contrast is measured against the adjacent colour
                     (>= 3:1, WCAG 1.4.11) and reported per element.
     4. contrast   — measured, not guessed: effective foreground colour
                     (alpha + element/ancestor opacity, composited) against
                     the nearest opaque background (ancestors walked, layers
                     composited). FAIL < 4.5:1 for normal text and < 3:1 for
                     large text (>= 24px, or >= 18.66px bold); WARN below 7:1
                     (4.5:1 for large). Disabled controls are WARN-only.
     5. reduced-motion — with prefers-reduced-motion: reduce emulated: no
                     running CSS animation/transition longer than 300 ms, and
                     the hero region is sampled twice 800 ms apart and must be
                     pixel-identical (a "frozen end frame" heuristic).
     6. motion-control — if a content region animates for more than 5 s or
                     loops on load (detected by watching the hero region for
                     DOM mutations from page setup, and by
                     document.getAnimations()), a control whose accessible name
                     matches /pause|stop|play|replay/i must exist: absent ->
                     FAIL; a replay-only control (no pause/stop) -> WARN. A
                     looping ambient background is WARNed independently, even
                     when a pause control covers the foreground story (a hero
                     pause button does not stop a body::after loop). Text that
                     changes in the animated region with no aria-live is a
                     live-region WARN.

   Resolution strategy (no personal absolute paths are baked in):
     playwright-core: repo/cwd node_modules -> script-dir node_modules ->
                      process.env.PLAYWRIGHT_DIR (a node_modules directory)
     chromium:        chromium.launch() plain -> executablePath:
                      process.env.CHROME -> scanned default browser directory
                      (process.env.PLAYWRIGHT_BROWSERS_PATH, else the platform
                      default, i.e. ~/.cache/ms-playwright on Linux) — both
                      env vars clearly override the documented default.
   Env overrides: PLAYWRIGHT_DIR, CHROME, PLAYWRIGHT_BROWSERS_PATH, SITE_DIR.

   Node builtins + optional playwright-core.
     node scripts/a11y-check.mjs
   Exit 0 = clean or skipped, 1 = at least one FAIL, 2 = checker error.
   ========================================================================== */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(process.env.SITE_DIR || join(HERE, "..", "site"));
const PAGES = ["index.html", "scan.html", "combos.html", "benchmarks.html", "threat-model.html", "disclosure.html"];
const AUX = ["style.css", "animate.js"];
/* hero-ish region, most specific first — used for motion sampling */
const REGION_SELECTORS = ["[data-attack]", "[data-scene]", ".hero-product", "main", "section"];
const VIEWPORT = { width: 1280, height: 800 };
const TAB_CAP = 200;
const MOTION_CAP_MS = 16000;   // hard ceiling on listening for hero-region motion
const MOTION_PROBE_MS = 4000;  // bail out this early when none has appeared at all
const QUIET_MS = 1500;         // region considered settled after this much silence
const SKIP_SETTLE_MS = 450;    // wait out CSS transitions before judging the skip link
const FROZEN_GAP_MS = 800;

const oneLine = (e) => String((e && e.message) || e).split("\n")[0].slice(0, 220);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/* ====================================================================== ·
   resolve + launch: playwright-core optional, chromium optional
   ====================================================================== */
function resolvePlaywright() {
  const attempts = [];
  const bases = [
    { label: `repo/cwd node_modules (${process.cwd()})`, file: join(process.cwd(), "package.json") },
    { label: `script dir node_modules (${HERE})`, file: fileURLToPath(import.meta.url) },
  ];
  if (process.env.PLAYWRIGHT_DIR) {
    bases.push({ label: `PLAYWRIGHT_DIR=${process.env.PLAYWRIGHT_DIR}`, file: join(process.env.PLAYWRIGHT_DIR, "index.js") });
  } else {
    bases.push({ label: "PLAYWRIGHT_DIR", note: "not set" });
  }
  for (const b of bases) {
    if (b.note) { attempts.push(b); continue; }
    try {
      const req = createRequire(b.file);
      const p = req.resolve("playwright-core");
      attempts.push({ label: b.label, ok: p });
      return { mod: req(p), path: p, attempts };
    } catch (e) {
      attempts.push({ label: b.label, err: oneLine(e) });
    }
  }
  return { mod: null, attempts };
}

function defaultChromiumPaths() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache", "ms-playwright");
  let entries = [];
  try { entries = readdirSync(root); } catch { return { root, paths: [] }; }
  const ver = (n) => parseInt((n.match(/(\d+)\s*$/) || [0, "0"])[1], 10) || 0;
  const dirs = entries
    .filter((n) => /^chromium(_headless_shell)?(-|_)?\d*$/.test(n) || /^chromium/.test(n))
    .sort((a, b) => ver(b) - ver(a));
  const sub = ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-linux64/headless_shell", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"];
  const paths = [];
  for (const d of dirs) for (const s of sub) paths.push(join(root, d, s));
  return { root, paths };
}

async function launchChromium(chromium) {
  const tries = [];
  try {
    const browser = await chromium.launch();
    tries.push("chromium.launch() -> launched");
    return { browser, how: "chromium.launch()", tries };
  } catch (e) {
    tries.push(`chromium.launch() -> ${oneLine(e)}`);
  }
  const cands = [];
  if (process.env.CHROME) cands.push({ p: process.env.CHROME, how: "CHROME env" });
  const def = defaultChromiumPaths();
  for (const p of def.paths) cands.push({ p, how: `default dir (${def.root})` });
  if (!cands.length) tries.push("no CHROME env and no chromium-* directories found in the default browser dir");
  for (const c of cands) {
    if (!existsSync(c.p)) { tries.push(`${c.how}: ${c.p} -> not found`); continue; }
    try {
      const browser = await chromium.launch({ executablePath: c.p });
      tries.push(`${c.how}: ${c.p} -> launched`);
      return { browser, how: c.p, tries };
    } catch (e) {
      tries.push(`${c.how}: ${c.p} -> ${oneLine(e)}`);
    }
  }
  return { browser: null, tries };
}

function skipNotice(reason, pwAttempts, launchAttempts) {
  console.log("SKIPPED — needs playwright-core and a chromium binary");
  console.log(`  reason: ${reason}`);
  console.log("  playwright-core resolution attempts:");
  for (const a of pwAttempts) {
    if (a.ok) console.log(`    ok  ${a.label} -> ${a.ok}`);
    else console.log(`    x   ${a.label}${a.note ? ` (${a.note})` : ""}${a.err ? ` -> ${a.err}` : ""}`);
  }
  if (launchAttempts && launchAttempts.length) {
    console.log("  chromium launch attempts:");
    for (const t of launchAttempts) console.log(`    x   ${t}`);
  }
  console.log("  fix: PLAYWRIGHT_DIR=/path/to/node_modules (containing playwright-core) and/or");
  console.log("       CHROME=/path/to/chrome, or install playwright-core and a chromium build.");
  process.exit(0);
}

/* ====================================================================== ·
   findings
   ====================================================================== */
const findings = [];
const add = (level, page, check, msg, sel) => findings.push({ level, page, check, msg, sel });
const pageNotes = new Map(); // `${page}|${check}` -> ok-note
const note = (page, check, msg) => pageNotes.set(`${page}|${check}`, msg);

/* ====================================================================== ·
   in-page helpers (installed once per page, after load)
   ====================================================================== */
const INSTALL_HELPERS = () => {
  const H = {
    txt(el) { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 72); },
    sel(el) {
      if (!el || el.nodeType !== 1) return "(none)";
      const parts = [];
      let n = el;
      while (n && n.nodeType === 1 && parts.length < 4) {
        let s = n.tagName.toLowerCase();
        if (n.id && /^[\w-]+$/.test(n.id)) { parts.unshift(s + "#" + n.id); break; }
        const cls = (n.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) s += "." + cls.join(".");
        parts.unshift(s);
        n = n.parentElement;
      }
      return parts.join(" > ");
    },
    accName(el) {
      const ga = el.getAttribute.bind(el);
      const lb = ga("aria-labelledby");
      if (lb) {
        const t = lb.split(/\s+/).map((id) => { const r = document.getElementById(id); return r ? (r.textContent || "") : ""; }).join(" ").replace(/\s+/g, " ").trim();
        if (t) return { name: t, via: "aria-labelledby" };
      }
      const al = ga("aria-label");
      if (al && al.trim()) return { name: al.trim(), via: "aria-label" };
      if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes((el.type || "").toLowerCase()) && el.value && el.value.trim())
        return { name: el.value.trim(), via: "value" };
      if (el.id) {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l && l.textContent.trim()) return { name: l.textContent.replace(/\s+/g, " ").trim(), via: "label" };
      }
      const wl = el.closest("label");
      if (wl && wl.textContent.trim()) return { name: wl.textContent.replace(/\s+/g, " ").trim(), via: "label(wrap)" };
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t) return { name: t, via: "text" };
      const im = el.querySelector("img[alt]");
      if (im && im.alt.trim()) return { name: im.alt.trim(), via: "img alt" };
      const ti = ga("title");
      if (ti && ti.trim()) return { name: ti.trim(), via: "title" };
      const ph = ga("placeholder");
      if (ph && ph.trim()) return { name: "", via: null, placeholderOnly: ph.trim() };
      return { name: "", via: null };
    },
    snap(el) {
      const s = getComputedStyle(el);
      /* deliberately excludes opacity/transform: scroll-reveal transitions and
         opacity toggles must not count as a focus indication */
      return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset, s.boxShadow,
              s.backgroundColor, s.borderTopColor, s.borderTopWidth, s.color, s.filter].join("|");
    },
    parse(c) {
      c = String(c).trim();
      let m = c.match(/^rgba?\(([^)]+)\)$/i);
      if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
      m = c.match(/^#([0-9a-f]{3,8})$/i);
      if (m) {
        let h = m[1];
        if (h.length === 3) h = h.split("").map((x) => x + x).join("");
        const n = parseInt(h.slice(0, 6), 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
      }
      if (c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
      return { r: 0, g: 0, b: 0, a: 1 };
    },
    over(top, bottom) { const a = top.a; return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }; },
    lum(c) { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); },
    ratio(fg, bg) { const a = H.lum(fg), b = H.lum(bg), hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); },
    hex(c) { const h = (v) => Math.round(v).toString(16).padStart(2, "0"); return "#" + h(c.r) + h(c.g) + h(c.b); },
    bgOf(el, bottom) {
      const layers = [];
      let n = el;
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n);
        const l = H.parse(cs.backgroundColor);
        if (cs.backgroundImage && cs.backgroundImage !== "none" && /gradient/.test(cs.backgroundImage)) l.gradient = true;
        layers.push(l);
        n = n.parentElement;
      }
      let comp = H.parse(bottom || "#07080a"); // canvas fallback
      let gradient = false;
      for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].a > 0) comp = H.over(layers[i], comp);
        if (layers[i].gradient) gradient = true;
      }
      return { color: comp, gradient };
    },
    opacityOf(el) {
      let o = 1, n = el;
      while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity || "1"); if (o < 0.02) return o; n = n.parentElement; }
      return o;
    },
    visible(el) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility !== "visible") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    focusableSel: 'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable="true"]',
  };
  window.__a11y = H;
};

/* ====================================================================== ·
   per-page run
   ====================================================================== */
async function runPage(browser, pageName) {
  const url = pathToFileURL(join(SITE, pageName)).href;
  const pageErrors = [];
  const log = (s) => console.log(s);

  /* ---------------- normal pass ---------------- */
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(oneLine(e)));
  await p.goto(url, { waitUntil: "load", timeout: 20000 });
  await p.waitForTimeout(350);
  await p.evaluate(INSTALL_HELPERS);

  log(`\n-- ${pageName}`);

  /* Start watching the hero region for DOM changes NOW, before any other
     check: hero stories are typically scroll-triggered (their own
     IntersectionObserver), and the Tab walk itself can scroll them into view
     and start the run. The observer must already be recording to capture the
     full story. It only observes — no scrolling here: scrollIntoView() would
     move Chromium's sequential-focus starting point mid-page and break the
     Tab walk below. The scroll trigger happens after the walk. */
  await p.evaluate((sels) => {
    const region = sels.map((s) => document.querySelector(s)).find(Boolean) || document.body;
    const rec = { region: window.__a11y.sel(region), first: null, last: null, count: 0, textMutations: 0, attrs: {}, t0: performance.now() };
    const mo = new MutationObserver((muts) => {
      const t = performance.now();
      if (rec.first === null) rec.first = t;
      rec.last = t;
      rec.count += muts.length;
      for (const m of muts) {
        if (m.type === "characterData" || (m.type === "childList" && m.addedNodes.length && !m.attributeName)) rec.textMutations++;
        if (m.attributeName) rec.attrs[m.attributeName] = (rec.attrs[m.attributeName] || 0) + 1;
      }
    });
    mo.observe(region, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "transform", "opacity", "d", "disabled"] });
    window.__motion = () => ({ ...rec, now: performance.now() });
    window.__motionStop = () => mo.disconnect();
    window.__motionRegion = region;
  }, REGION_SELECTORS);

  /* --- 1. landmarks + headings --- */
  const dom = await p.evaluate(() => {
    const H = window.__a11y;
    const counts = {};
    for (const t of ["header", "nav", "main", "footer"]) counts[t] = document.querySelectorAll(t).length;
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ level: +h.tagName[1], text: H.txt(h), sel: H.sel(h) }));
    return { counts, headings };
  });
  for (const lm of ["nav", "main", "footer"]) {
    if (dom.counts[lm] === 0) add("FAIL", pageName, "landmarks", `no <${lm}> landmark on the page`);
  }
  if (dom.counts.header === 0) add("WARN", pageName, "landmarks", "no <header> (banner landmark is optional but expected here)");
  const h1s = dom.headings.filter((h) => h.level === 1);
  if (h1s.length !== 1) {
    add("FAIL", pageName, "headings", h1s.length === 0
      ? `no <h1>; the first heading is <h${dom.headings[0] ? dom.headings[0].level : "?"}> ("${dom.headings[0] ? dom.headings[0].text : "none"}")`
      : `${h1s.length} <h1> elements (exactly one required)`);
  }
  for (let i = 1; i < dom.headings.length; i++) {
    const prev = dom.headings[i - 1], cur = dom.headings[i];
    if (cur.level > prev.level + 1) {
      add("FAIL", pageName, "headings", `level skip: h${prev.level} ("${prev.text}") -> h${cur.level} ("${cur.text}")`, cur.sel);
    }
  }
  if (!findings.some((f) => f.page === pageName && f.check === "headings")) {
    note(pageName, "headings", `${dom.headings.length} headings, one h1, no level skips`);
  }
  if (!findings.some((f) => f.page === pageName && f.check === "landmarks")) {
    note(pageName, "landmarks", `header x${dom.counts.header}, nav x${dom.counts.nav}, main x${dom.counts.main}, footer x${dom.counts.footer}`);
  }

  /* --- 2. accessible names --- */
  const names = await p.evaluate(() => {
    const H = window.__a11y;
    const out = { controls: [], imgs: [], svgs: [], srOnlyPattern: 0 };
    const SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
    for (const el of document.querySelectorAll(SEL)) {
      if (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "hidden") continue;
      if (H.visible(el)) {
        const n = H.accName(el);
        out.controls.push({ sel: H.sel(el), text: H.txt(el), name: n.name, via: n.via, placeholderOnly: n.placeholderOnly || null, inAriaHidden: !!el.closest('[aria-hidden="true"]'), disabled: !!el.disabled });
      }
    }
    for (const img of document.images) out.imgs.push({ sel: H.sel(img), alt: img.getAttribute("alt") });
    for (const svg of document.querySelectorAll("svg")) {
      const hidden = svg.getAttribute("aria-hidden") === "true" || ["presentation", "none"].includes(svg.getAttribute("role"));
      const label = svg.getAttribute("aria-label") || svg.getAttribute("aria-labelledby") || (svg.querySelector(":scope > title") ? "title" : null);
      const role = svg.getAttribute("role");
      out.svgs.push({ sel: H.sel(svg), hidden, label, role, inControl: !!svg.closest("a[href], button") });
    }
    return out;
  });
  let nameFails = 0;
  for (const c of names.controls) {
    if (!c.name) {
      nameFails++;
      add("FAIL", pageName, "names", `<${c.sel.split(" > ").pop().split(".")[0].split("#")[0]}> has an empty accessible name${c.placeholderOnly ? ` (placeholder "${c.placeholderOnly}" is not a name)` : ""}${c.disabled ? " [disabled]" : ""}`, c.sel);
    }
    if (c.inAriaHidden) add("FAIL", pageName, "names", "focusable control inside aria-hidden=\"true\"", c.sel);
  }
  for (const im of names.imgs) if (im.alt === null) add("FAIL", pageName, "names", "<img> without alt attribute", im.sel);
  for (const s of names.svgs) {
    if (s.hidden || s.label) continue;
    if (s.role === "img" || (s.role || "").startsWith("graphics")) add("FAIL", pageName, "names", `non-decorative SVG (role="${s.role}") has no title/aria-label`, s.sel);
    else add("WARN", pageName, "names", `SVG is neither aria-hidden nor labelled${s.inControl ? " (inside a link/button)" : ""} — if decorative, add aria-hidden="true"`, s.sel);
  }
  if (!nameFails && names.controls.length) note(pageName, "names", `${names.controls.length} controls, ${names.imgs.length} img, ${names.svgs.length} svg — all named`);

  /* --- 3. keyboard walk --- */
  const cands = await p.evaluate(() => {
    const H = window.__a11y;
    const out = [];
    let i = 0;
    for (const el of document.querySelectorAll(H.focusableSel)) {
      if (el.disabled) continue;
      /* Native media controls live in a shadow root. Chromium reports each
         internal control as the video host itself, so the sequential-focus
         probe sees a repeated stop and stops walking — every control after
         the video is then reported unreachable. The host is keyboard
         reachable in a real browser; skip it here rather than miscounting
         the rest of the page. */
      if (el.matches("video[controls], audio[controls]")) continue;
      const ti = el.getAttribute("tabindex");
      if (ti !== null && parseInt(ti, 10) < 0) continue;
      if (el.closest("[hidden]")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true, contentVisibilityAuto: true })) continue;
      /* [inert] subtrees are rendered but the browser refuses focus and skips
         them in the tab order; checkVisibility (above) already catches
         content-visibility:hidden — which is how a closed <details> hides its
         content in this engine (the children keep a layout box, so rect-based
         visibility alone would miscount them as visible controls). Neither
         may be reported as a visible-but-unreachable control. */
      if (el.inert || el.closest("[inert]")) continue;
      const r = el.getBoundingClientRect();
      el.__a11yIdx = i;
      el.__a11yPre = H.snap(el);
      out.push({
        i, sel: H.sel(el), text: H.txt(el), tag: el.tagName.toLowerCase(),
        visible: r.width > 0 && r.height > 0,
        name: H.accName(el).name,
        positiveTabindex: ti !== null && parseInt(ti, 10) > 0,
        href: el.tagName === "A" ? el.getAttribute("href") : null,
        pre: { rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, transform: cs.transform, opacity: cs.opacity, visibility: cs.visibility, outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor },
        inAriaHidden: !!el.closest('[aria-hidden="true"]'),
      });
      i++;
    }
    return out;
  });
  for (const c of cands.filter((x) => x.positiveTabindex)) {
    add("WARN", pageName, "keyboard", "positive tabindex value reorders the tab sequence away from document order", c.sel);
  }

  const start = await p.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.focus();
    return document.activeElement ? document.activeElement.tagName : "NONE";
  });
  let startNote = "";
  if (start !== "BODY") {
    await p.evaluate(() => { document.body.setAttribute("tabindex", "-1"); document.body.focus(); });
    startNote = " (body focused via a temporary tabindex=-1, audit-only)";
  }

  const visited = new Map();
  const walk = [];
  const totalCands = cands.length;
  const unvisitedVisible = () => cands.filter((c) => c.visible && !visited.has(c.i)).length;

  const probeStop = () => p.evaluate(() => {
    const H = window.__a11y;
    const ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement) return { kind: "body" };
    const idx = typeof ae.__a11yIdx === "number" ? ae.__a11yIdx : -1;
    const pre = ae.__a11yPre;
    const now = H.snap(ae);
    const r = ae.getBoundingClientRect();
    const cs = getComputedStyle(ae);
    let ring = null;
    const ow = parseFloat(cs.outlineWidth) || 0;
    if (cs.outlineStyle !== "none" && ow > 0) {
      const rc = H.parse(cs.outlineColor);
      const bg = H.bgOf(ae.parentElement || ae);
      const c = rc.a < 1 ? H.over(rc, bg.color) : rc;
      ring = { kind: "outline", color: H.hex(c), ratio: +H.ratio(c, bg.color).toFixed(2), width: ow, vs: H.hex(bg.color) };
    } else if (cs.boxShadow && cs.boxShadow !== "none") {
      const m = cs.boxShadow.match(/rgba?\([^)]+\)/);
      if (m) {
        const sc = H.parse(m[0]);
        const bg = H.bgOf(ae.parentElement || ae);
        const c = sc.a < 1 ? H.over(sc, bg.color) : sc;
        ring = { kind: "box-shadow", color: H.hex(c), ratio: +H.ratio(c, bg.color).toFixed(2), width: 0, vs: H.hex(bg.color) };
      }
    }
    return {
      kind: "el", idx, sel: H.sel(ae), text: H.txt(ae),
      changed: pre !== now, focusVisible: ae.matches(":focus-visible"), ring,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      transform: cs.transform, opacity: cs.opacity,
    };
  });

  /* forward pass: real Tab traversal. Reaching the body means the tab order
     ran off the end of the document; a repeated stop means it wrapped. */
  for (let press = 0; press < TAB_CAP; press++) {
    await p.keyboard.press("Tab");
    const info = await probeStop();
    if (info.kind === "body") break;
    if (info.idx >= 0 && visited.has(info.idx)) break;
    if (info.idx >= 0) visited.set(info.idx, info);
    walk.push({ ...info, dir: "tab" });
    if (!unvisitedVisible()) break;
  }
  /* backward fallback pass (Shift+Tab): covers stops that lie before a
     mid-document sequential-focus starting point, which Chromium can keep
     after programmatic scrolling; reachability via Shift+Tab is the same
     tab order read backwards. */
  let back = 0, sinceNew = 0;
  while (unvisitedVisible() && back < TAB_CAP && sinceNew <= totalCands + 2) {
    await p.keyboard.press("Shift+Tab");
    back++;
    const info = await probeStop();
    if (info.kind === "body") break;
    if (info.idx >= 0 && !visited.has(info.idx)) { visited.set(info.idx, info); walk.push({ ...info, dir: "shift+tab" }); sinceNew = 0; }
    else sinceNew++;
  }
  await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  const visibleCands = cands.filter((c) => c.visible);
  const unreachable = visibleCands.filter((c) => !visited.has(c.i));
  let kbFails = 0;
  for (const c of unreachable) {
    kbFails++;
    add("FAIL", pageName, "keyboard", `visible interactive element is not keyboard-reachable: <${c.tag}> "${c.text || c.name}"`, c.sel);
  }
  for (const w of walk) {
    if (!w.changed) {
      kbFails++;
      add("FAIL", pageName, "keyboard", `no visible focus indicator — computed outline/box-shadow/background/border/transform unchanged when focused`, w.sel);
    } else if (w.ring && w.ring.ratio < 3) {
      kbFails++;
      add("FAIL", pageName, "keyboard", `focus ring contrast ${w.ring.ratio}:1 (${w.ring.kind} ${w.ring.color} on ${w.ring.vs}) is below 3:1 (WCAG 1.4.11)`, w.sel);
    } else if (w.changed && !w.ring) {
      add("WARN", pageName, "keyboard", `focus indicator present but not measurable as outline/box-shadow (change was in another property)`, w.sel);
    }
  }
  const skip = visibleCands.find((c) => /skip-link|skip[\s-]?to/i.test(c.sel + " " + c.text + " " + c.name));
  if (skip) {
    const post = visited.get(skip.i);
    const firstStop = walk.length && walk[0].idx === skip.i;
    add("INFO", pageName, "skip-link",
      `skip link "${skip.text}": before focus rect ${JSON.stringify(skip.pre.rect)} transform=${skip.pre.transform} opacity=${skip.pre.opacity}; ` +
      `immediately after first Tab -> rect ${post ? JSON.stringify(post.rect) : "never focused"} transform=${post ? post.transform : "?"}; ` +
      `firstTabStop=${firstStop} focusVisible=${post ? post.focusVisible : "?"}`);
    if (!post || !firstStop) add("WARN", pageName, "skip-link", "skip link was not the first Tab stop reached from the top of the document");
    /* settle re-check: the skip link often animates in with a CSS transition,
       so an instant sample can catch it at progress ~0. Tab to it again, wait
       out the transition, then judge the final box. */
    await p.evaluate(() => {
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae.blur) ae.blur();
      document.body.setAttribute("tabindex", "-1");
      document.body.focus();
    });
    await p.keyboard.press("Tab");
    await p.waitForTimeout(SKIP_SETTLE_MS);
    const settled = await probeStop();
    const settledOnSkip = settled.kind === "el" && settled.idx === skip.i;
    const ref = settledOnSkip ? settled : (post && post.kind === "el" ? post : null);
    const stillHidden = !!(ref && ref.rect.y + ref.rect.h <= 0);
    if (settledOnSkip) {
      add("INFO", pageName, "skip-link",
        `after settling (${SKIP_SETTLE_MS} ms post-Tab): rect ${JSON.stringify(settled.rect)} transform=${settled.transform} opacity=${settled.opacity} focusVisible=${settled.focusVisible}`);
    } else {
      add("WARN", pageName, "skip-link", `first Tab no longer lands on the skip link in the settle re-check (focus went to ${settled.kind === "el" ? settled.sel : settled.kind})`);
    }
    if (stillHidden) add("FAIL", pageName, "skip-link", "skip link never becomes visible on focus (its box stays fully above the viewport even after transitions settle)");
    /* activation: Enter on the skip link must reach its in-page target */
    const targetHref = skip.href && /^#/.test(skip.href) ? skip.href : null;
    const preAct = await p.evaluate(() => ({ hash: location.hash, y: Math.round(window.scrollY) }));
    await p.keyboard.press("Enter");
    await p.waitForTimeout(350);
    const act = await p.evaluate((tgt) => ({
      hash: location.hash, y: Math.round(window.scrollY),
      targetExists: tgt ? !!document.querySelector(tgt) : null,
      active: document.activeElement === document.body ? "BODY" : (document.activeElement.tagName + (document.activeElement.id ? "#" + document.activeElement.id : "")),
    }), targetHref);
    add("INFO", pageName, "skip-link",
      `Enter -> hash=${act.hash || "(none)"} scrollY ${preAct.y}->${act.y} active=${act.active}${targetHref ? ` target=${targetHref} ${act.targetExists ? "exists" : "MISSING"}` : ""}`);
    if (targetHref && act.targetExists === false) add("FAIL", pageName, "skip-link", `skip link points at ${targetHref} but no element with that id exists`);
  }
  const fwdCount = walk.filter((w) => w.dir === "tab").length;
  const backCount = walk.length - fwdCount;
  if (!kbFails) note(pageName, "keyboard", `${visited.size}/${visibleCands.length} visible stops reached (${fwdCount} forward${backCount ? `, ${backCount} via Shift+Tab fallback` : ""})${startNote}`);

  /* --- motion trigger: the observer has been recording since page setup;
     bring the region into view now that the walk is complete, so a
     scroll-triggered story starts (if the walk had not already started it),
     then let the wait loop below collect the run. Scrolling is safe here:
     the keyboard walk is already finished. */
  await p.evaluate(() => {
    const region = window.__motionRegion;
    if (region) region.scrollIntoView({ block: "center" });
  });
  await p.waitForTimeout(250);

  const animSample = () => p.evaluate(() => {
    const out = [];
    for (const a of document.getAnimations()) {
      let t = {};
      try { t = a.effect ? a.effect.getTiming() : {}; } catch (e) {}
      out.push({
        type: a.constructor.name,
        name: a.animationName || a.transitionProperty || a.constructor.name,
        duration: typeof t.duration === "number" ? t.duration : null,
        iterations: t.iterations === Infinity ? "infinite" : (t.iterations ?? null),
        playState: a.playState,
        target: a.effect && a.effect.target ? window.__a11y.sel(a.effect.target) : null,
        pseudo: (a.effect && a.effect.pseudoElement) || null,
      });
    }
    return out;
  });

  let animsEarly = [];
  const t0 = Date.now();
  let sawMutations = false;
  while (Date.now() - t0 < MOTION_CAP_MS) {
    await p.waitForTimeout(250);
    const rec = await p.evaluate(() => window.__motion());
    if (rec.last !== null) sawMutations = true;
    if (!animsEarly.length && (sawMutations || Date.now() - t0 > 1500)) animsEarly = await animSample();
    if (sawMutations && rec.now - rec.last > QUIET_MS) break;    // ran (at least partly during the walk) and settled
    if (!sawMutations && Date.now() - t0 > MOTION_PROBE_MS) break; // nothing moves on this page
  }
  const motion = await p.evaluate(() => { const r = window.__motion(); window.__motionStop(); return r; });
  const animsSettled = await animSample();
  const span = motion.first !== null ? Math.round(motion.last - motion.first) : 0;

  /* --- prime scroll: trigger every IntersectionObserver reveal --- */
  await p.evaluate(async () => {
    const step = Math.round(innerHeight * 0.9);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 220));
    }
    await new Promise((r) => setTimeout(r, 700));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
  await p.waitForTimeout(300);
  log(`   motion: region ${motion.region} — ${motion.count} mutations, span ${span} ms, ${motion.textMutations} text updates`);

  /* --- 4. contrast --- */
  const contrast = await p.evaluate(() => {
    const H = window.__a11y;
    const out = { findings: [], checked: 0, skippedHidden: 0, skippedTiny: 0 };
    const seen = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = w.nextNode())) {
      const t = node.nodeValue;
      if (!t || !t.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "noscript", "template"].includes(tag)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility !== "visible") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) { out.skippedTiny++; continue; }   // .sr-only / clipped
      const op = H.opacityOf(el);
      if (op < 0.05) { out.skippedHidden++; continue; }
      const isSvgText = tag === "text" || tag === "tspan";
      const fg = H.parse(isSvgText ? cs.fill : cs.color);
      let bottom = null;
      if (isSvgText) {
        const g = el.closest("g");
        const rc = g ? g.querySelector("rect") : null;
        if (rc && rc.getBoundingClientRect().width > 0) bottom = getComputedStyle(rc).fill;
      }
      const bg = H.bgOf(el, bottom);
      const fgFinal = H.over({ ...fg, a: Math.min(1, fg.a * op) }, bg.color);
      const ratio = H.ratio(fgFinal, bg.color);
      const size = parseFloat(cs.fontSize) || 0;
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const minFail = large ? 3 : 4.5;
      const minWarn = large ? 4.5 : 7;
      if (ratio < minWarn) {
        out.checked++;
        out.findings.push({
          level: ratio < minFail ? "FAIL" : "WARN",
          sel: H.sel(el), text: (t || "").replace(/\s+/g, " ").trim().slice(0, 42),
          fg: H.hex(fgFinal), bg: H.hex(bg.color), ratio: +ratio.toFixed(2),
          size: +size.toFixed(1), large, approx: !!bg.gradient, effOpacity: +op.toFixed(3),
          disabled: el.matches(":disabled") || !!el.closest("[disabled]"),
        });
      }
    }
    return out;
  });
  for (const f of contrast.findings) {
    const lv = f.disabled && f.level === "FAIL" ? "WARN" : f.level;
    add(lv, pageName, "contrast",
      `"${f.text}" fg ${f.fg} on bg ${f.bg} = ${f.ratio}:1 (${f.large ? "large" : "normal"} ${f.size}px${f.effOpacity < 1 ? `, effective opacity ${f.effOpacity}` : ""}${f.approx ? ", gradient backdrop approximated" : ""}${f.disabled ? ", disabled control -> WARN only" : ""})`,
      f.sel);
  }
  if (!contrast.findings.length) note(pageName, "contrast", `all measured text clears the WARN bar (${contrast.skippedTiny} clipped/1px, ${contrast.skippedHidden} invisible elements skipped)`);

  /* --- 6. motion control + live region --- */
  const controls = await p.evaluate(() => {
    const H = window.__a11y;
    const out = [];
    for (const el of document.querySelectorAll('a[href], button, input, summary, [role="button"]')) {
      if (!H.visible(el)) continue;
      const n = H.accName(el);
      if (n.name) out.push({ name: n.name.toLowerCase(), sel: H.sel(el), disabled: !!el.disabled });
    }
    return out;
  });
  const animAll = [...animsEarly, ...animsSettled];
  const running = animAll.filter((a) => a.playState === "running" || a.playState === "pending");
  const foreground = running.filter((a) => a.target && !/^(body|html)$/.test(a.target) && !a.pseudo);
  const ambient = running.filter((a) => a.pseudo || /^(body|html)$/.test(a.target || ""));
  const longFg = foreground.filter((a) => (typeof a.duration === "number" && a.duration > 5000) || a.iterations === "infinite");
  const looper = ambient.find((a) => a.iterations === "infinite");
  const regionRunsLong = span > 5000;
  const motionRuns = regionRunsLong || longFg.length > 0;
  const matching = controls.filter((c) => /pause|stop|play|replay/i.test(c.name));
  const pausable = controls.filter((c) => /pause|stop|hide/i.test(c.name));
  log(`   motion evidence: early=${animsEarly.length} settled=${animsSettled.length} animations, foreground-long=${longFg.length}, ambient-loop=${looper ? looper.name + " " + looper.duration + "ms/" + looper.iterations : "none"}, region-span=${span}ms`);
  if (motionRuns) {
    const ev = regionRunsLong ? `hero/content region animates for ${span} ms` : `animation ${longFg[0].name} runs ${longFg[0].duration} ms`;
    if (!matching.length) {
      add("FAIL", pageName, "motion-control", `${ev} (> 5 s) but no control named /pause|stop|play|replay/i exists (WCAG 2.2.2)`);
    } else if (!pausable.length) {
      add("WARN", pageName, "motion-control", `${ev} (> 5 s); only restart-style control(s) present: ${matching.map((m) => `"${m.name}"`).join(", ")} — WCAG 2.2.2 asks for pause/stop, not just replay`);
    } else {
      note(pageName, "motion-control", `long motion has a pause/stop control: ${pausable.map((m) => `"${m.name}"`).join(", ")}`);
    }
  } else if (controls.some((c) => /pause|stop|play|replay/i.test(c.name))) {
    note(pageName, "motion-control", "motion control present");
  } else if (!looper) {
    note(pageName, "motion-control", "no long-running or looping motion detected");
  }
  /* the ambient background loop is a separate concern from the story: a hero
     pause button does not stop a body::after animation, so warn either way */
  if (looper) {
    const covered = motionRuns && pausable.length > 0;
    add("WARN", pageName, "motion-control", `looping ambient background motion (${looper.name}, ${looper.duration} ms, ${looper.iterations}) — ${covered ? "the page's pause/stop control does not stop it; " : "no pause/stop control stops it; "}WCAG 2.2.2 arguably applies to backgrounds too`);
  }
  if (motion.textMutations > 0) {
    const lr = await p.evaluate(() => {
      const region = window.__motionRegion || document.body;
      const isScene = !!(region.closest && region.closest("[data-attack], [data-scene]"));
      const live = !!(region.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') || region.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]'));
      return { isScene, live };
    });
    if (lr.isScene && !lr.live) add("WARN", pageName, "live-region", `the animated hero region updates its text ${motion.textMutations} time(s) with no aria-live/role=status — screen readers get none of the changing narration`);
    else note(pageName, "live-region", lr.live ? "animated region has a live region" : `text churn without a live region (${motion.textMutations} updates — counters, not narration)`);
  }

  /* @@APPEND@@ */


  /* ---------------- reduced-motion pass ---------------- */
  const ctx2 = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const p2 = await ctx2.newPage();
  await p2.goto(url, { waitUntil: "load", timeout: 20000 });
  await p2.waitForTimeout(300);
  await p2.evaluate(INSTALL_HELPERS);
  const rm = await p2.evaluate(() => {
    const out = { matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches, running: [], offenders: [] };
    for (const a of document.getAnimations()) {
      let t = {};
      try { t = a.effect ? a.effect.getTiming() : {}; } catch (e) {}
      const dur = typeof t.duration === "number" ? t.duration : 0;
      const rec = {
        name: a.animationName || a.transitionProperty || a.constructor.name,
        duration: t.duration === Infinity ? "infinity" : dur,
        iterations: t.iterations === Infinity ? "infinite" : t.iterations,
        playState: a.playState,
        target: a.effect && a.effect.target ? window.__a11y.sel(a.effect.target) : null,
        pseudo: (a.effect && a.effect.pseudoElement) || null,
      };
      out.running.push(rec);
      if ((a.playState === "running" || a.playState === "pending") && dur > 300) out.offenders.push(rec);
    }
    return out;
  });
  let rmFails = 0;
  if (!rm.matches) add("WARN", pageName, "reduced-motion", "prefers-reduced-motion emulation did not match in the audit browser");
  for (const o of rm.offenders) {
    rmFails++;
    add("FAIL", pageName, "reduced-motion", `running animation/transition of ${o.duration}ms (> 300ms) under prefers-reduced-motion: ${o.name} [${o.target || "?"}${o.pseudo || ""}]`);
  }
  await p2.evaluate(() => {
    const r = document.querySelector("[data-attack]") || document.querySelector(".hero-product") || document.querySelector("section");
    if (r) r.scrollIntoView({ block: "center" });
  });
  await p2.waitForTimeout(300);
  const clip = await regionClip(p2);
  const fa = await p2.screenshot({ clip });
  await p2.waitForTimeout(FROZEN_GAP_MS);
  const fb = await p2.screenshot({ clip });
  const ha = sha(fa), hb = sha(fb);
  if (ha !== hb) {
    rmFails++;
    add("FAIL", pageName, "reduced-motion", `hero region visibly changes with prefers-reduced-motion: reduce — two frames ${FROZEN_GAP_MS}ms apart differ (${clip.width}x${clip.height} at ${clip.x},${clip.y})`);
  }
  if (!rmFails) note(pageName, "reduced-motion", `no animation >300ms running; hero region frozen across ${FROZEN_GAP_MS}ms`);
  await ctx2.close();

  await ctx.close();
  for (const e of pageErrors) add("FAIL", pageName, "runtime", `uncaught JS error: ${e}`);
  if (!pageErrors.length) note(pageName, "runtime", "no uncaught JS errors");
}

/* viewport-clipped screenshot region for the hero, most specific selector first */
async function regionClip(p) {
  const vp = p.viewportSize();
  for (const s of REGION_SELECTORS) {
    const el = await p.$(s);
    if (!el) continue;
    const box = await el.boundingBox();
    if (!box || box.width < 8 || box.height < 8) continue;
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const w = Math.min(vp.width, Math.ceil(box.x + box.width)) - x;
    const h = Math.min(vp.height, Math.ceil(box.y + box.height)) - y;
    if (w >= 40 && h >= 40) return { x, y, width: w, height: h };
  }
  return { x: 0, y: 0, width: Math.min(vp.width, 1200), height: Math.min(vp.height, 480) };
}

/* ====================================================================== ·
   report + summary
   ====================================================================== */
const CHECK_ORDER = ["runtime", "landmarks", "headings", "names", "keyboard", "skip-link", "contrast", "reduced-motion", "motion-control", "live-region"];

function printReport() {
  console.log("\n== report ==");
  for (const pageName of PAGES) {
    console.log(`\n-- ${pageName}`);
    const pf = findings.filter((f) => f.page === pageName);
    if (!pf.length) console.log("   (no findings at all — clean page)");
    for (const lvl of ["FAIL", "WARN", "INFO"]) {
      for (const f of pf.filter((x) => x.level === lvl)) {
        console.log(`   ${lvl.padEnd(4)} ${f.check.padEnd(15)} ${f.msg}${f.sel ? `  [${f.sel}]` : ""}`);
      }
    }
    for (const c of CHECK_ORDER) {
      const n = pageNotes.get(`${pageName}|${c}`);
      if (n && !pf.some((f) => f.check === c)) console.log(`   ok   ${c.padEnd(15)} ${n}`);
    }
  }
}

/* ====================================================================== ·
   main
   ====================================================================== */
async function main() {
  console.log("== LethalPath a11y check (file:// + headless chromium) ==");
  console.log(`site: ${SITE}`);
  if (!existsSync(SITE)) {
    console.log(`  site directory not found — set SITE_DIR`);
    process.exit(2);
  }
  console.log("-- source snapshot (the site may be edited concurrently; these hashes pin this run)");
  for (const f of [...PAGES, ...AUX]) {
    const fp = join(SITE, f);
    if (!existsSync(fp)) { console.log(`  ${f.padEnd(18)} MISSING`); continue; }
    console.log(`  ${f.padEnd(18)} mtime ${statSync(fp).mtime.toISOString()}  sha256:${sha(readFileSync(fp)).slice(0, 12)}`);
  }

  const pw = resolvePlaywright();
  if (!pw.mod) skipNotice("playwright-core could not be resolved", pw.attempts, []);
  const launched = await launchChromium(pw.mod.chromium);
  if (!launched.browser) skipNotice("no chromium binary could be launched", pw.attempts, launched.tries);
  console.log(`playwright-core: ${pw.path}`);
  console.log(`chromium: launched via ${launched.how}`);

  const started = Date.now();
  for (const pageName of PAGES) {
    try {
      await runPage(launched.browser, pageName);
    } catch (e) {
      add("FAIL", pageName, "runtime", "checker error while auditing this page: " + oneLine(e));
    }
  }
  await launched.browser.close().catch(() => {});

  printReport();

  const fails = findings.filter((f) => f.level === "FAIL");
  const warns = findings.filter((f) => f.level === "WARN");
  const infos = findings.filter((f) => f.level === "INFO");
  console.log("\n== summary ==");
  console.log(`  pages: ${PAGES.length}   FAIL: ${fails.length}   WARN: ${warns.length}   INFO: ${infos.length}   (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  const byCheck = {};
  for (const f of fails) byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  const byPage = {};
  for (const f of fails) byPage[f.page] = (byPage[f.page] || 0) + 1;
  if (fails.length) {
    console.log(`  FAIL by check: ${Object.entries(byCheck).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`  FAIL by page : ${Object.entries(byPage).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`\nFAIL — ${fails.length} failure(s)\n`);
    process.exit(1);
  }
  console.log(`\nPASS — no FAIL-level findings${warns.length ? ` (${warns.length} warning(s) worth reading)` : ""}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("checker error: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});


