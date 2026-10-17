/* ==========================================================================
   LethalPath — animation engine. No dependencies, no network.

   Four systems:
     1. reveal()    — scroll-triggered entrances via IntersectionObserver
     2. AttackPlay  — the hero scene. A timed timeline walks a data packet down
        the leak path, taints the agent context, exfiltrates through git.push,
        then cuts the route: the gate slams, the packet is refused and recoils,
        and the dead route greys out. Pausable and replayable (WCAG 2.2.2);
        reduced-motion users get the complete story as one static end frame —
        the markup itself carries that frame, so it is correct with JS off too.
     3. countUp()   — KPI numbers count from 0 to their exact printed string
        when revealed; reduced-motion users see the final value immediately.
     4. copyButtons() — a Copy affordance on every code block, injected only
        when the browser can actually put text on the clipboard.

   The scene is the point: a beginning, a turn, and an end.
   ========================================================================== */
(function () {
  "use strict";

  // arm the CSS reveal system only when JS is actually running
  document.documentElement.classList.add("js");

  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // one easing family for everything the eye follows
  var EASE_TRAVEL = "cubic-bezier(.22,.61,.36,1)";

  var now = function () {
    return (window.performance && window.performance.now)
      ? window.performance.now() : Date.now();
  };

  /* ---------------------------------------------------------------- reveal */
  function reveal() {
    var nodes = document.querySelectorAll("[data-reveal]");
    if (!nodes.length) return;
    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
    nodes.forEach(function (n, i) {
      n.style.transitionDelay = Math.min(i % 5, 4) * 70 + "ms";
      io.observe(n);
    });
  }

  /* ------------------------------------------------------------ hero scene
     Node geometry mirrors the SVG in index.html. Keeping it here — and
     verifying it with scripts/site-check.mjs — means the animation and the
     drawing can never disagree about where things are.
  */
  var PATH = {
    issue:   { x: 56,  y: 70 },
    github:  { x: 202, y: 70 },
    context: { x: 329, y: 70 },
    fs:      { x: 458, y: 70 },
    priv:    { x: 567, y: 70 },
    git:     { x: 202, y: 169 },
    pub:     { x: 350, y: 169 }
  };

  // The walk, in order: each node centre, plus the two corners of the long
  // route the packet takes from the private folder down to the push.
  var WALK = [
    [56, 70],                       // public issue
    [202, 70],                      // github read
    [329, 70],                      // agent context
    [458, 70],                      // filesystem write
    [567, 70],                      // private files
    [567, 120],                     // corner: down out of the folder
    [202, 120],                     // corner: across to the push
    [202, 169],                     // git push
    [350, 169]                      // public repo
  ];

  // hops in order: [waypoint index, travel ms, beat to announce on arrival]
  var HOPS = [
    [1, 720, 1],
    [2, 640, 2],
    [3, 640, 3],
    [4, 620, 4],
    [5, 300, -1],
    [6, 860, -1],
    [7, 340, 5],
    [8, 380, 6]
  ];

  // each beat: caption, tone, the node it lights, and what the turn is
  var SCRIPT = [
    { node: "issue",   tone: "untrusted", text: "A stranger hides an instruction in a public issue." },
    { node: "github",  tone: "untrusted", text: "Your agent reads it. It cannot tell your words from theirs." },
    { node: "context", tone: "sink",      text: "The instruction now sits in your agent's context.", taint: true },
    { node: "fs",      tone: "private",   text: "The agent reads your private folder \u2014 for a real reason." },
    { node: "priv",    tone: "private",   text: "Private data and a stranger's words, in the same place." },
    { node: "git",     tone: "danger",    text: "The push leaves through your own git remote." },
    { node: "pub",     tone: "danger",    text: "The folder is public. No single tool misbehaved." }
  ];

  var CAP_READY = "Ready.";
  var CAP_CUT   = "Revoke git.push \u2014 the write this route needs.";
  var CAP_END   = "Route closed. The files stay private.";

  function AttackPlay(root) {
    var svg = root.querySelector("[data-scene]");
    if (!svg) return;

    var packet  = root.querySelector("[data-packet]");
    var trail   = root.querySelector("[data-trail]");
    var gate    = root.querySelector("[data-gate]");
    var alarm   = root.querySelector("[data-alarm]");
    var caption = root.querySelector("[data-caption]");
    var stepEl  = root.querySelector("[data-step]");
    var replay  = root.querySelector("[data-replay]");
    var pauseB  = root.querySelector("[data-pause]");
    var pauseLbl = root.querySelector("[data-pause-label]");
    var statusEl = root.querySelector("[data-status]");
    var tickEls = root.querySelectorAll(".steps i");
    var nodes = {};
    root.querySelectorAll("[data-node]").forEach(function (n) {
      nodes[n.getAttribute("data-node")] = n;
    });
    var ctx = root.querySelector("[data-ctx]") || nodes["context"];

    /* ---- the clock: a virtual timeline that can be paused and resumed ---- */
    var steps = [];      // { t, fn, done }
    var timers = [];
    var base = 0;        // virtual ms consumed before the current run segment
    var t0 = 0;          // real clock at the start of the current segment
    var running = false;
    var paused = false;
    var finished = false;
    var pausedAnims = [];

    function at(t, fn) { steps.push({ t: t, fn: fn, done: false }); }
    function virtualNow() { return base + (running ? now() - t0 : 0); }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function schedule() {
      clearTimers();
      steps.forEach(function (s) {
        if (s.done) return;
        var delay = Math.max(0, s.t - virtualNow());
        timers.push(setTimeout(function () {
          if (s.done) return;
          s.done = true;
          s.fn();
        }, delay));
      });
    }

    // freeze/thaw whatever CSS is mid-flight (transitions, the gate slam)
    function pauseCss() {
      pausedAnims = [];
      if (!document.getAnimations) return;
      try {
        document.getAnimations().forEach(function (a) {
          if (a.playState === "running") { a.pause(); pausedAnims.push(a); }
        });
      } catch (e) { /* nothing to freeze */ }
    }
    function resumeCss() {
      pausedAnims.forEach(function (a) { try { a.play(); } catch (e) {} });
      pausedAnims = [];
    }

    /* ---------------------------- scene states ---------------------------- */
    function setCaption(text, tone) {
      if (!caption) return;
      caption.textContent = text;
      caption.setAttribute("data-tone", tone || "");
    }
    function setStep(text) { if (stepEl) stepEl.textContent = text; }
    function lightTicks(n) {
      tickEls.forEach(function (el, i) { el.classList.toggle("on", i < n); });
    }
    function moveTo(i, ms) {
      if (!packet) return;
      var p = WALK[i];
      packet.style.transition = "transform " + ms + "ms " + EASE_TRAVEL + ", opacity 200ms ease";
      packet.setAttribute("transform", "translate(" + p[0] + "," + p[1] + ")");
    }
    function growTrailTo(i) {
      if (!trail) return;
      var d = trail.getAttribute("d") || "";
      var p = WALK[i];
      trail.setAttribute("d", d + (d ? " L" : "M") + p[0] + " " + p[1]);
      trail.style.opacity = "1";
    }
    function taintContext() {
      if (ctx) ctx.classList.add("tainted");
      if (alarm) {
        alarm.style.opacity = "1";
        alarm.classList.remove("pulse");
        void alarm.getBoundingClientRect();       // restart the pulse on replay
        alarm.classList.add("pulse");
      }
    }
    function announce(b) {
      var s = SCRIPT[b];
      if (!s) return;
      if (nodes[s.node]) nodes[s.node].classList.add("lit");
      setCaption(s.text, s.tone);
      lightTicks(b + 1);
      setStep((b + 1) + " / " + SCRIPT.length);
    }

    /* the initial state, exactly what the first frame of the story shows */
    function resetScene() {
      clearTimers();
      running = false;
      paused = false;
      finished = false;
      root.classList.remove("blocked");
      if (packet) {
        packet.style.transition = "none";
        packet.setAttribute("transform", "translate(" + WALK[0][0] + "," + WALK[0][1] + ")");
        packet.style.opacity = "0";
      }
      if (trail) { trail.setAttribute("d", ""); trail.style.opacity = "0"; }
      if (gate)  { gate.style.opacity = "0"; gate.classList.remove("slam", "hit"); }
      if (alarm) { alarm.style.opacity = "0"; alarm.classList.remove("pulse"); }
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove("lit", "tainted"); });
      setCaption(CAP_READY, "");
      lightTicks(0);
      setStep("0 / " + SCRIPT.length);
      if (pauseB) {
        pauseB.disabled = true;
        pauseB.classList.remove("is-paused");
        if (pauseLbl) pauseLbl.textContent = "Pause";
      }
    }

    /* the whole story, as one timeline */
    function buildStory() {
      var t = 260;

      at(t, function () {
        if (packet) {
          packet.style.transition = "opacity 200ms ease";
          packet.style.opacity = "1";
        }
        announce(0);
      });

      HOPS.forEach(function (hop) {
        t += 120;
        var depart = t;
        var arrive = depart + hop[1];
        at(depart, function () { moveTo(hop[0], hop[1]); });
        at(arrive - 40, function () { growTrailTo(hop[0]); });
        if (hop[2] >= 0) {
          at(arrive, function () { announce(hop[2]); });
          if (SCRIPT[hop[2]].taint) at(arrive + 340, taintContext);
        }
        t = arrive;
      });

      var end = t;                                   // the private folder is public

      // the fix: one bar lands across the write edge
      at(end + 620, function () {
        if (gate) {
          gate.style.opacity = "1";
          gate.classList.remove("slam", "hit");
          void gate.getBoundingClientRect();
          gate.classList.add("slam");
        }
        setCaption(CAP_CUT, "safe");
      });
      at(end + 820, function () { if (packet) packet.style.opacity = "0"; });

      // the retry: the packet runs the route again and is refused at the cut
      at(end + 1420, function () {
        if (!packet) return;
        packet.style.transition = "none";
        packet.setAttribute("transform", "translate(" + WALK[4][0] + "," + WALK[4][1] + ")");
        void packet.getBoundingClientRect();
        packet.style.transition = "opacity 200ms ease";
        packet.style.opacity = "1";
      });
      at(end + 1620, function () { moveTo(5, 260); });
      at(end + 1880, function () { moveTo(6, 820); });
      at(end + 2700, function () { moveTo(7, 320); });
      at(end + 3020, function () { moveTo(8, 300); });
      at(end + 3020 + 300, function () {
        // impact, recoil back off the gate, and fade
        if (gate) {
          gate.classList.remove("hit");
          void gate.getBoundingClientRect();
          gate.classList.add("hit");
        }
        if (packet) {
          packet.style.transition = "transform 240ms " + EASE_TRAVEL + ", opacity 320ms ease";
          packet.setAttribute("transform", "translate(244,169)");
          packet.style.opacity = "0";
        }
      });

      // the end state: the route is dead, and it shows
      at(end + 3860, function () {
        root.classList.add("blocked");
        if (alarm) alarm.style.opacity = "0";
        setCaption(CAP_END, "safe");
        finished = true;
        if (pauseB) { pauseB.disabled = true; setPaused(false); }
        setStatus(CAP_END);
      });
    }

    function start() {
      resetScene();
      steps.forEach(function (s) { s.done = false; });
      base = 0;
      running = true;
      t0 = now();
      if (pauseB) pauseB.disabled = false;
      setPaused(false);
      setStatus("Replaying the committed run.");
      schedule();
    }

    function setPaused(p) {
      paused = p;
      if (!pauseB) return;
      pauseB.classList.toggle("is-paused", p);
      if (pauseLbl) pauseLbl.textContent = p ? "Play" : "Pause";
    }
    /* the scene's captions and counters update ~20 times per run; the live
       region announces only the two milestones (started, closed) so screen
       readers get the outcome without the chatter. */
    function setStatus(t) {
      if (statusEl) statusEl.textContent = t;
    }
    function pause() {
      if (!running || paused || finished) return;
      base = virtualNow();
      running = false;
      clearTimers();
      pauseCss();
      setPaused(true);
    }
    function resume() {
      if (!paused) return;
      t0 = now();
      running = true;
      setPaused(false);
      schedule();
      resumeCss();
    }

    buildStory();

    if (replay) {
      replay.disabled = false;
      replay.addEventListener("click", function () {
        resumeCss();
        start();
      });
    }
    if (pauseB) {
      pauseB.addEventListener("click", function () {
        if (finished) return;
        if (paused) resume(); else pause();
      });
    }

    if (reduced) {
      // no motion at all: the markup already shows the complete end frame
      // (taint, cut, dead route, summary). Only the hidden step label updates.
      setStep(SCRIPT.length + " / " + SCRIPT.length);
    } else if ("IntersectionObserver" in window) {
      resetScene();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !finished && !running) {
            start();
            io.disconnect();
          }
        });
      }, { threshold: 0.35 });
      io.observe(root);
    } else {
      start();
    }
  }

  /* ------------------------------------------------------------- count-ups
     Any element marked [data-count] whose printed text is a plain number
     (or a ratio like 40/40) counts from zero to that exact string when it
     scrolls into view. The final frame is byte-identical to the markup. */
  function countUp() {
    var els = document.querySelectorAll("[data-count]");
    if (!els.length) return;

    var items = [];
    els.forEach(function (el) {
      var finalText = (el.textContent || "").trim();
      var m = finalText.match(/^(\d+)(?:\/(\d+))?$/);
      if (m) {
        items.push({
          el: el,
          a: parseInt(m[1], 10),
          b: m[2] !== undefined ? parseInt(m[2], 10) : null,
          final: finalText
        });
      }
      // anything that is not a plain number is left exactly as written
    });
    if (!items.length) return;

    // reduced motion, or no observer: the markup already shows the final value
    if (reduced || !("IntersectionObserver" in window) || !window.requestAnimationFrame) return;

    function animate(item) {
      var t0c = null;
      var DUR = 900;
      function frame(ts) {
        if (t0c === null) t0c = ts;
        var p = Math.min((ts - t0c) / DUR, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        if (p < 1) {
          var s = String(Math.round(item.a * eased));
          if (item.b !== null) s += "/" + String(Math.round(item.b * eased));
          item.el.textContent = s;
          requestAnimationFrame(frame);
        } else {
          item.el.textContent = item.final; // land on the exact printed string
        }
      }
      requestAnimationFrame(frame);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var item = null;
        items.forEach(function (it) { if (it.el === e.target) item = it; });
        if (item) setTimeout(function () { animate(item); }, 140);
      });
    }, { threshold: 0.5 });
    items.forEach(function (item) { io.observe(item.el); });
  }

  /* ---------------------------------------------------------- copy buttons
     Injected only when the browser can plausibly complete the action, so a
     control never promises something it cannot do. */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(legacyCopy(text)); }
      );
    } else {
      done(legacyCopy(text));
    }
  }

  function copyButtons() {
    var boxes = document.querySelectorAll(".code");

    boxes.forEach(function (box) {
      var pre = box.querySelector("pre");
      if (!pre) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-quiet btn-sm";
      btn.classList.add("copy-btn");
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code to clipboard");

      var timer = null;
      btn.addEventListener("click", function () {
        var text = pre.innerText || pre.textContent || "";
        copyText(text, function (ok) {
          if (!ok) return;
          btn.textContent = "Copied";
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { btn.textContent = "Copy"; }, 1400);
        });
      });

      box.appendChild(btn);
    });

    // any control that names a target copies that target's text: the policy
    // diff on the scan page is real clipboard content, not decoration
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      var target = document.querySelector(btn.getAttribute("data-copy"));
      if (!target) return;
      var label = btn.textContent;
      var timer = null;
      btn.addEventListener("click", function () {
        copyText(target.innerText || target.textContent || "", function (ok) {
          if (!ok) return;
          btn.textContent = "Copied";
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { btn.textContent = label; }, 1400);
        });
      });
    });
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    reveal();
    document.querySelectorAll("[data-attack]").forEach(AttackPlay);
    countUp();
    copyButtons();

    // the scan page's Apply cut: flips the finding to its resolved state
    document.querySelectorAll("[data-applycut]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var finding = btn.closest("[data-finding]");
        if (!finding) return;
        var on = finding.classList.toggle("resolved");
        btn.textContent = on ? "Cut applied" : "Apply cut";
        btn.classList.toggle("btn-safe", !on);
        btn.classList.toggle("btn-quiet", on);
      });
    });
  }

  // this script is the last element in every page's body, so the DOM is
  // already parsed: boot synchronously, before first paint, so the scene can
  // never flash its end frame. (Fallback covers a hypothetical <head> load.)
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
