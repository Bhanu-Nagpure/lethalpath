#!/usr/bin/env node
/* ==========================================================================
   LethalPath site check — one gate for everything the static site promises.

   Ported and merged from three ad-hoc audits (structure/links/classes,
   AAA contrast, SVG↔animation alignment) and extended with:
     - referenced local assets exist (link/script/img)
     - required head metadata (theme-color, canonical, Open Graph, favicon)
     - og:title / og:description are byte-identical to title / description
     - self-containment: no external resource references, anywhere
     - the social-card source (og-card.html) is pinned to 1200×630
     - landmark figures still appear verbatim (the number policy)

   Node builtins only. Repo-relative — run from anywhere:
     node scripts/site-check.mjs
   Exits non-zero with a summary when anything fails.
   ========================================================================== */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "site");

const PAGES = ["index.html", "scan.html", "combos.html", "benchmarks.html", "threat-model.html", "disclosure.html"];
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "use", "stop"]);
const BASE_URL = "https://www.devanshustudios.com/lethalpath/";

let failures = 0;
let structureProblems = 0;
const fail = (page, msg) => { failures++; structureProblems++; console.log(`  ✗ [${page}] ${msg}`); };
const ok = (msg) => console.log(`  ok ${msg}`);

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripBlocks = (s, tag) => s.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi"), "");

const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR_RE = /([\w:@.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function attrsOf(raw) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) out[m[1]] = m[2] ?? m[3] ?? true;
  return out;
}

/* ===================================================================== A ·
   structure / links / a11y / dead classes  (was: check.mjs)
   ===================================================================== */
console.log(`\n== A · structure, links, a11y  (${SITE}) ==`);

const titles = new Map(), descs = new Map();
const usedClasses = new Set();
const navLinks = {}, navAria = {};

const metaContent = (src, key, attr = "property") => {
  const m = src.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`));
  return m ? m[1] : null;
};

for (const page of PAGES) {
  console.log(`\n-- ${page}`);
  const file = join(SITE, page);
  const src = readFileSync(file, "utf8");

  /* stack-based tag balance */
  const scanSrc = stripBlocks(stripBlocks(stripComments(src), "style"), "script");
  const stack = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(scanSrc))) {
    const [, close, tag, , selfClose] = m;
    const t = tag.toLowerCase();
    if (VOID.has(t) || selfClose) continue;
    if (!close) stack.push({ t, idx: m.index });
    else {
      if (!stack.length) fail(page, `closing </${t}> with empty stack`);
      else {
        const top = stack.pop();
        if (top.t !== t) fail(page, `mismatch: <${top.t}> (offset ${top.idx}) closed by </${t}> (offset ${m.index})`);
      }
    }
  }
  if (stack.length) fail(page, `unclosed: ${stack.map(s => "<" + s.t + ">@" + s.idx).join(", ")}`);

  /* targeted nesting */
  const structural = [];
  TAG_RE.lastIndex = 0;
  const stack2 = [];
  while ((m = TAG_RE.exec(scanSrc))) {
    const [, close, tag, , selfClose] = m;
    const t = tag.toLowerCase();
    if (close) { stack2.pop(); continue; }
    const parent = stack2[stack2.length - 1];
    if (t === "figcaption" && parent && parent.t !== "figure") structural.push(`<figcaption> inside <${parent.t}> (must be child of <figure>)`);
    if ((t === "thead" || t === "tbody" || t === "caption") && parent && parent.t !== "table") structural.push(`<${t}> inside <${parent.t}> (must be child of <table>)`);
    if (t === "tr" && parent && !["thead", "tbody", "table"].includes(parent.t)) structural.push(`<tr> inside <${parent.t}>`);
    if ((t === "td" || t === "th") && parent && parent.t !== "tr") structural.push(`<${t}> inside <${parent.t}>`);
    if (t === "li" && parent && !["ul", "ol"].includes(parent.t)) structural.push(`<li> inside <${parent.t}>`);
    if (t === "a" && parent && parent.t === "a") structural.push(`<a> nested inside <a>`);
    if (t === "button" && parent && parent.t === "button") structural.push(`<button> nested inside <button>`);
    if (!VOID.has(t) && !selfClose) stack2.push({ t });
  }
  if (structural.length) structural.forEach(s => fail(page, "nesting: " + s));

  /* ids */
  const ids = [];
  const idRe = /\sid="([^"]+)"/g;
  while ((m = idRe.exec(src))) ids.push(m[1]);
  const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupIds.length) fail(page, `duplicate ids: ${[...new Set(dupIds)].join(", ")}`);

  /* titles + descriptions (unique across pages) */
  const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  if (!title) fail(page, "missing <title>");
  else if (titles.has(title)) fail(page, `title duplicates ${titles.get(title)}: "${title}"`);
  else titles.set(title, page);
  const desc = metaContent(src, "description", "name");
  if (!desc) fail(page, "missing meta description");
  else if (descs.has(desc)) fail(page, `description duplicates ${descs.get(desc)}`);
  else descs.set(desc, page);

  /* lang / viewport / charset */
  if (!/<html lang="[^"]+"/.test(src)) fail(page, "missing html[lang]");
  if (!/<meta name="viewport"/.test(src)) fail(page, "missing viewport meta");
  if (!/<meta charset="utf-8">/.test(src)) fail(page, "missing charset");
  if (/<img\b/.test(src)) fail(page, "has <img> - need alt audit");

  /* hrefs resolve (same-page anchors, cross-page files + fragments) */
  const hrefRe = /<a\b[^>]*href="([^"]+)"[^>]*>/g;
  while ((m = hrefRe.exec(src))) {
    const href = m[1];
    if (href.startsWith("#")) {
      const target = href.slice(1);
      if (!ids.includes(target)) fail(page, `broken same-page anchor ${href}`);
    } else if (!/^https?:|^mailto:|^tel:/.test(href)) {
      const [pathPart, frag] = href.split("#");
      if (!existsSync(join(SITE, pathPart))) fail(page, `broken link ${href}`);
      else if (frag) {
        const target = readFileSync(join(SITE, pathPart), "utf8");
        if (!new RegExp(`\\sid="${frag}"`).test(target)) fail(page, `anchor ${href} not found in ${pathPart}`);
      }
    }
  }

  /* referenced local assets exist (link / script / img) */
  const assetRe = /<(link|script|img)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  while ((m = assetRe.exec(src))) {
    const tag = m[1].toLowerCase();
    const attrs = attrsOf(m[2]);
    const url = tag === "link" ? attrs.href : attrs.src;
    if (!url || typeof url !== "string") continue;
    if (/^(https?:|data:|mailto:|#)/.test(url)) continue;
    if (!existsSync(join(SITE, url.split("#")[0].split("?")[0]))) fail(page, `<${tag}> references missing file: ${url}`);
  }

  /* required head metadata (task: SEO / social / favicon invariants) */
  const req = {
    "theme-color": /<meta name="theme-color" content="#08090c">/,
    "canonical link": /<link rel="canonical" href="https:\/\/www\.devanshustudios\.com\/lethalpath\//,
    "og:type": /<meta property="og:type" content="website">/,
    "og:site_name": /<meta property="og:site_name" content="LethalPath">/,
    "og:image": /<meta property="og:image" content="https:\/\/www\.devanshustudios\.com\/lethalpath\/og\.png">/,
    "og:image:width": /<meta property="og:image:width" content="1200">/,
    "og:image:height": /<meta property="og:image:height" content="630">/,
    "twitter:card": /<meta name="twitter:card" content="summary_large_image">/,
    "favicon": /<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/,
  };
  for (const [name, re] of Object.entries(req)) if (!re.test(src)) fail(page, `missing head metadata: ${name}`);

  const ogTitle = metaContent(src, "og:title");
  const ogDesc = metaContent(src, "og:description");
  const ogUrl = metaContent(src, "og:url");
  const canonical = (src.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
  if (ogTitle === null) fail(page, "missing og:title");
  else if (title !== undefined && ogTitle !== title) fail(page, "og:title does not equal <title> byte-for-byte");
  if (ogDesc === null) fail(page, "missing og:description");
  else if (desc !== undefined && ogDesc !== desc) fail(page, "og:description does not equal meta description byte-for-byte");
  if (ogUrl === null) fail(page, "missing og:url");
  else if (!ogUrl.startsWith(BASE_URL)) fail(page, `og:url does not start with ${BASE_URL}`);
  const expectedCanonical = page === "index.html" ? BASE_URL : BASE_URL + page;
  if (canonical !== expectedCanonical) fail(page, `canonical is "${canonical}", expected "${expectedCanonical}"`);

  /* nav links + aria-current tallies */
  navLinks[page] = [...src.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)]
    .flatMap(navBlock => [...navBlock[0].matchAll(/href="([^"]+)"/g)].map(x => x[1]));
  navAria[page] = [...src.matchAll(/aria-current="page"/g)].length;

  /* classes actually used */
  const classRe = /class="([^"]*)"/g;
  while ((m = classRe.exec(src))) m[1].split(/\s+/).forEach(c => c && usedClasses.add(c));
}

console.log("\n-- nav aria-current");
for (const page of PAGES) {
  const selfLinked = navLinks[page].includes(page);
  if (selfLinked && navAria[page] === 0) fail(page, 'nav links to itself but no aria-current="page"');
  else if (!selfLinked) console.log(`  note [${page}] not linked from the nav (footer only) - aria-current not applicable`);
  else ok(`[${page}] aria-current="page" on the active nav item`);
}

/* JS-added classes count as used */
const js = readFileSync(join(SITE, "animate.js"), "utf8");
for (const q of js.matchAll(/["']([A-Za-z][\w-]*)["']/g)) usedClasses.add(q[1]);

console.log("\n-- style.css class usage");
const cssRaw = readFileSync(join(SITE, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const cssClasses = new Set();
for (const mm of cssRaw.matchAll(/\.([A-Za-z][\w-]*)/g)) cssClasses.add(mm[1]);
const dead = [...cssClasses].filter(c => !usedClasses.has(c)).sort();
console.log(dead.length ? dead.map(c => `  dead? .${c}`).join("\n") : "  (none)");

/* self-containment: no external resource references, no network APIs */
console.log("\n-- self-containment");
for (const page of PAGES) {
  const src = readFileSync(join(SITE, page), "utf8");
  const linkRe = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = linkRe.exec(src))) {
    const attrs = attrsOf(m[1]);
    const rel = String(attrs.rel || "");
    if (!/^(stylesheet|icon|apple-touch-icon|preload|manifest)$/.test(rel)) continue;
    if (typeof attrs.href === "string" && /^https?:/.test(attrs.href)) fail(page, `external resource: <link rel="${rel}"> → ${attrs.href}`);
  }
  const scriptRe = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  while ((m = scriptRe.exec(src))) {
    const attrs = attrsOf(m[1]);
    if (typeof attrs.src === "string" && /^https?:/.test(attrs.src)) fail(page, `external resource: <script src> → ${attrs.src}`);
  }
}
const css = readFileSync(join(SITE, "style.css"), "utf8");
if (/@import/.test(css)) fail("style.css", "has @import");
if (/url\(\s*['"]?https?:/.test(css)) fail("style.css", "loads an external URL");
if (/https?:\/\//.test(js)) fail("animate.js", "contains an http(s) URL");
if (/\bfetch\s*\(/.test(js)) fail("animate.js", "calls fetch()");
ok("no external resources, no network calls");

console.log("\n-- landmark figures (number policy: these must appear verbatim)");
const landmarks = {
  "index.html": ["40/40", "8/8", "FalkorDB 6.0.2", "The leak is a path.", "Close it."],
  "scan.html": ["567", "one of 567 routes", "write grants", "0 remain"],
  "combos.html": ["35", "11", "50/50"],
  "benchmarks.html": ["detection.json", "fix-quality.json", "50/50 match"],
  "threat-model.html": ["falkordb/falkordb:6.0.2"],
  "disclosure.html": ["SECURITY.md"],
};
let landmarkFails = 0;
for (const [page, needles] of Object.entries(landmarks)) {
  const src = readFileSync(join(SITE, page), "utf8");
  for (const needle of needles) if (!src.includes(needle)) { landmarkFails++; fail(page, `landmark missing: "${needle}"`); }
}
if (!landmarkFails) ok("landmark figures present");

/* social card + favicon assets */
console.log("\n-- assets");
if (!existsSync(join(SITE, "favicon.svg"))) fail("favicon.svg", "missing");
else {
  const fav = readFileSync(join(SITE, "favicon.svg"), "utf8");
  if (!/<svg[\s\S]*<\/svg>/.test(fav)) fail("favicon.svg", "not a complete SVG document");
  else ok("favicon.svg parses as a complete SVG document");
}
if (!existsSync(join(SITE, "og-card.html"))) fail("og-card.html", "missing");
else {
  const og = readFileSync(join(SITE, "og-card.html"), "utf8");
  if (!/width:1200px/.test(og) || !/height:630px/.test(og)) fail("og-card.html", "is not pinned to 1200×630");
  if (!/overflow:hidden/.test(og)) fail("og-card.html", "does not clip overflow");
  if (/https?:\/\//.test(og)) fail("og-card.html", "references an external URL");
  else ok("og-card.html: 1200×630, clipped, self-contained");
}

/* ===================================================================== B ·
   AAA contrast  (was: contrast.mjs — token table preserved 1:1)
   ===================================================================== */
console.log("\n== B · contrast (WCAG, AAA target) ==");

const tokens = {};
{
  const root = css.match(/:root\{([\s\S]*?)\}/);
  for (const decl of root[1].replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const d = decl.match(/^\s*(--[\w-]+)\s*:\s*([^;]+?)\s*$/);
    if (d) tokens[d[1]] = d[2];
  }
}

function parseColor(s, seen = new Set()) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^var\((--[\w-]+)\)$/))) {
    if (seen.has(m[1]) || !(m[1] in tokens)) throw new Error("unresolved " + s);
    seen.add(m[1]);
    return parseColor(tokens[m[1]], seen);
  }
  if (s === "#fff") s = "#ffffff";
  if (s === "#000") s = "#000000";
  if ((m = s.match(/^#([0-9a-f]{3,8})$/i))) {
    let h = m[1];
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  if ((m = s.match(/^rgba?\(([^)]+)\)$/i))) {
    const p = m[1].split(",").map(v => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  throw new Error("cannot parse colour: " + s);
}
const num = (c) => (typeof c === "string" ? parseColor(c) : c);
const over = (top, bottom) => {
  const t = num(top), b = num(bottom), a = t.a;
  return { r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a), a: 1 };
};
const mix = (c, a, bg) => over({ ...num(c), a }, bg);
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (fg, bg) => {
  const [hi, lo] = [lum(num(fg)), lum(num(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

const canvas = parseColor("var(--canvas)");
const surface = parseColor("var(--surface)");
const surface2 = parseColor("var(--surface-2)");
const surface3 = parseColor("var(--surface-3)");
const tier = { canvas, surface, "surface-2": surface2, "surface-3": surface3 };

const special = {
  "code #050607": parseColor("#050607"),
  "window body (rgba(13,13,13,.86) over canvas)": mix("#0d0d0d", .86, canvas),
  "window bar (+white .03)": mix("#ffffff", .03, mix("#0d0d0d", .86, canvas)),
  "shot #0a0c10 (+white .03)": mix("#ffffff", .03, parseColor("#0a0c10")),
  "statrow cell (rgba(13,13,13,.8) over canvas)": mix("#0d0d0d", .8, canvas),
  "nav (rgba(7,8,10,.82) over canvas)": mix("#07080a", .82, canvas),
  "kicker bg (white .03 over canvas)": mix("#ffffff", .03, canvas),
  "btn-quiet hover #1f2022": parseColor("#1f2022"),
  "btn-primary hover #e8e8e8": parseColor("#e8e8e8"),
};
const tags = {
  "tag-un bg (.10 over surface-2)": mix("#ffc533", .10, surface2),
  "tag-pr bg (.10 over surface-2)": mix("#a78bfa", .10, surface2),
  "tag-sk bg (.10 over surface-2)": mix("#57c1ff", .10, surface2),
  "tag-le bg (.10 over surface-2)": mix("#ff6b6b", .10, surface2),
  "tag-sf bg (.10 over surface-2)": mix("#59d499", .10, surface2),
  "tag-pl bg (surface-3)": surface3,
  "finding-h bg (danger .06 over surface)": mix("#ff6b6b", .06, surface),
  "finding-h resolved bg (safe .06 over surface)": mix("#59d499", .06, surface),
  "fixbox bg (safe .07 over surface)": mix("#59d499", .07, surface),
  "strip bg (safe .09 over surface)": mix("#59d499", .09, surface),
  "caption bg (surface-2)": surface2,
  "scene node rect #121212": parseColor("#121212"),
  "scene node untrusted rect #1a1608": parseColor("#1a1608"),
  "scene node sink rect #0b1418": parseColor("#0b1418"),
  "scene node private rect #16121f": parseColor("#16121f"),
  "tainted context rect #0d2230 (behind sink stroke/text)": parseColor("#0d2230"),
  "btn-primary (white)": parseColor("#ffffFFFF"),
  "btn-safe (safe fill)": parseColor("var(--safe)"),
  "page canvas": canvas,
};

const rows = [];
function check(group, pair, fg, bg, min = 7) {
  if (fg === undefined || bg === undefined) throw new Error(`colour missing for pair: ${pair}`);
  const r = ratio(fg, bg);
  rows.push({ group, pair, ratio: r, min, pass: r >= min });
}
const V = (k) => tokens[k];

const textTokens = ["--ink", "--body", "--mute", "--ash", "--untrusted", "--private", "--sink", "--danger", "--safe", "--kw", "--num"];
const kw = "#FF9EC4", numTok = "#FFD9A0";
for (const tok of textTokens) {
  const val = tok === "--kw" ? kw : tok === "--num" ? numTok : V(tok);
  if (!val) { console.log("  MISSING TOKEN", tok); continue; }
  for (const [name, bg] of Object.entries(tier)) check("tokens x tiers", `${tok} on --${name}`, val, bg);
}

check("code tokens", ".kw on code", kw, special["code #050607"]);
check("code tokens", ".fn (sink) on code", V("--sink"), special["code #050607"]);
check("code tokens", ".rel (untrusted) on code", V("--untrusted"), special["code #050607"]);
check("code tokens", ".lbl (private) on code", V("--private"), special["code #050607"]);
check("code tokens", ".str (safe) on code", V("--safe"), special["code #050607"]);
check("code tokens", ".com (ash) on code", V("--ash"), special["code #050607"]);
check("code tokens", ".num on code", numTok, special["code #050607"]);
check("code tokens", "pre body text on code", V("--body"), special["code #050607"]);

check("chrome", "nav nb body on nav bg", V("--body"), special["nav (rgba(7,8,10,.82) over canvas)"]);
check("chrome", ".pill/.window-title mute on window bar", V("--mute"), special["window bar (+white .03)"]);
check("chrome", ".scene-bar mute on window body", V("--mute"), special["window body (rgba(13,13,13,.86) over canvas)"]);
check("chrome", "kicker body on kicker bg", V("--body"), special["kicker bg (white .03 over canvas)"]);
check("chrome", ".shot .ghost mute on shot bg", V("--mute"), special["shot #0a0c10 (+white .03)"]);
check("chrome", "statrow cell ink on statrow bg", V("--ink"), special["statrow cell (rgba(13,13,13,.8) over canvas)"]);
check("chrome", "statrow cell mute on statrow bg", V("--mute"), special["statrow cell (rgba(13,13,13,.8) over canvas)"]);

check("tags", ".tag-un #FFC533 on tint", "#FFC533", tags["tag-un bg (.10 over surface-2)"]);
check("tags", ".tag-pr #B69EFB on tint", "#B69EFB", tags["tag-pr bg (.10 over surface-2)"]);
check("tags", ".tag-sk #57C1FF on tint", "#57C1FF", tags["tag-sk bg (.10 over surface-2)"]);
check("tags", ".tag-le #FF8A8A on tint", "#FF8A8A", tags["tag-le bg (.10 over surface-2)"]);
check("tags", ".tag-sf #59D499 on tint", "#59D499", tags["tag-sf bg (.10 over surface-2)"]);
check("tags", ".tag-pl mute on surface-3", V("--mute"), tags["tag-pl bg (surface-3)"]);

check("status states", ".finding-h danger on tint", V("--danger"), tags["finding-h bg (danger .06 over surface)"]);
check("status states", ".finding-h resolved safe on tint", V("--safe"), tags["finding-h resolved bg (safe .06 over surface)"]);
check("status states", ".strip safe on tint", V("--safe"), tags["strip bg (safe .09 over surface)"]);
check("status states", ".fixbox body on tint", V("--body"), tags["fixbox bg (safe .07 over surface)"]);
check("status states", ".caption ink on surface-2", V("--ink"), tags["caption bg (surface-2)"]);
check("status states", ".diff .del danger on surface", V("--danger"), surface);
check("status states", ".diff .add safe on surface", V("--safe"), surface);
check("status states", ".win safe on surface", V("--safe"), surface);
check("status states", ".lose untrusted on surface", V("--untrusted"), surface);
check("status states", ".kpi .v accent values on surface", V("--danger"), surface);
check("status states", ".dstep .n mute on surface-3", V("--mute"), surface3);

check("buttons", ".btn-primary #000 on #fff", "#000000", tags["btn-primary (white)"], 4.5);
check("buttons", ".btn-primary:hover #000 on #e8e8e8", "#000000", special["btn-primary hover #e8e8e8"], 4.5);
check("buttons", ".btn-ghost ink on page bg", V("--ink"), canvas);
check("buttons", ".btn-quiet ink on surface-3", V("--ink"), surface3);
check("buttons", ".btn-quiet:hover ink on #1f2022", V("--ink"), special["btn-quiet hover #1f2022"]);
check("buttons", ".btn-safe #06170f on safe", "#06170f", V("--safe"));

check("svg scene", "stage labels (ash) on window body", V("--ash"), special["window body (rgba(13,13,13,.86) over canvas)"]);
check("svg scene", "node sub-labels (ash) on #121212 rect", V("--ash"), tags["scene node rect #121212"]);
check("svg scene", "github label (body) on #121212 rect", V("--body"), tags["scene node rect #121212"]);
check("svg scene", "untrusted label on #1a1608 rect", "#FFC533", tags["scene node untrusted rect #1a1608"]);
check("svg scene", "sink label on #0b1418 rect", "#57C1FF", tags["scene node sink rect #0b1418"]);
check("svg scene", "private label on #16121f rect", "#B69EFB", tags["scene node private rect #16121f"]);
check("svg scene", "sink label on tainted rect #0d2230", "#57C1FF", tags["tainted context rect #0d2230 (behind sink stroke/text)"]);
check("svg scene", "gate label safe on window body", "#59D499", special["window body (rgba(13,13,13,.86) over canvas)"]);
check("svg scene", ".path .arrow ash on finding surface", V("--ash"), surface);

let contrastFails = 0;
for (const g of [...new Set(rows.map(r => r.group))]) {
  const group = rows.filter(x => x.group === g);
  const bad = group.filter(r => !r.pass);
  if (bad.length) {
    contrastFails += bad.length;
    failures += bad.length;
    for (const r of bad) console.log(`  ✗ ${g}: ${r.pair} → ${r.ratio.toFixed(2)}:1 (needs >=${r.min})`);
  } else ok(`${g}: ${group.length} pairs clear the bar`);
}

/* header-comment pairs: recomputed so the table at the top of style.css can be audited */
const headerPairs = [
  ["--ink on canvas", V("--ink"), canvas],
  ["--body on canvas", V("--body"), canvas],
  ["--mute on canvas", V("--mute"), canvas],
  ["--untrusted on canvas", V("--untrusted"), canvas],
  ["--private on canvas", V("--private"), canvas],
  ["--sink on canvas", V("--sink"), canvas],
  ["--danger on canvas", V("--danger"), canvas],
  ["--safe on canvas", V("--safe"), canvas],
];
console.log("  header-comment pairs (recomputed for the style.css table):");
for (const [p, fg, bg] of headerPairs) console.log(`    ${p}: ${ratio(fg, bg).toFixed(2)}:1`);

/* ===================================================================== C ·
   SVG ↔ animation alignment  (was: align.mjs)
   ===================================================================== */
console.log("\n== C · hero scene alignment (SVG rects vs animate.js PATH) ==");
const html = readFileSync(join(SITE, "index.html"), "utf8");

const svgNodes = {};
const nodeRe = /<g class="node[^"]*"\s+data-node="([\w-]+)"[^>]*>([\s\S]*?)<\/g>/g;
let m;
while ((m = nodeRe.exec(html))) {
  const id = m[1];
  const rect = m[2].match(/<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/);
  if (!rect) { console.log(`  ✗ node ${id}: no rect found`); failures++; continue; }
  const [, x, y, w, h] = rect.map(Number);
  svgNodes[id] = { cx: x + w / 2, cy: y + h / 2 };
}

const pathMap = {};
const pathRe = /(\w+)\s*:\s*\{\s*x:\s*([\d.]+)\s*,\s*y:\s*([\d.]+)\s*\}/g;
while ((m = pathRe.exec(js))) pathMap[m[1]] = { x: +m[2], y: +m[3] };

const keys = new Set([...Object.keys(svgNodes), ...Object.keys(pathMap)]);
let alignBad = 0;
console.log("  node       svg-centre      animate.js PATH   dist   verdict");
for (const k of [...keys].sort()) {
  const s = svgNodes[k], p = pathMap[k];
  if (!s) { console.log(`  ✗ ${k}: MISSING in SVG`); alignBad++; failures++; continue; }
  if (!p) { console.log(`  ✗ ${k}: MISSING in animate.js PATH`); alignBad++; failures++; continue; }
  const dist = +Math.hypot(p.x - s.cx, p.y - s.cy).toFixed(2);
  const verdict = dist > 2 ? "FAIL (>2px)" : "pass";
  if (dist > 2) { alignBad++; failures++; }
  console.log(`  ${k.padEnd(10)} (${String(s.cx).padStart(3)},${String(s.cy).padStart(3)})      (${
    String(p.x).padStart(3)},${String(p.y).padStart(3)})      ${String(dist).padStart(6)}   ${verdict}`);
}

/* ===================================================================== ·
   summary
   ===================================================================== */
console.log("\n== summary ==");
console.log(`  structure/links/a11y : ${structureProblems ? structureProblems + " problem(s)" : "no structural problems found"}`);
console.log(`  contrast             : ${rows.length} pairs, ${contrastFails} failing`);
console.log(`  alignment            : ${alignBad ? alignBad + " node(s) off by >2px" : "all nodes aligned within 2px"}`);
console.log(failures ? `\nFAIL — ${failures} problem(s) found\n` : "\nPASS — all checks clean\n");
process.exit(failures ? 1 : 0);
