/* ==========================================================================
   LethalPath — animation engine. No dependencies, no network.

   Four systems:
     1. reveal()    — scroll-triggered entrances via IntersectionObserver
     2. AttackPlay  — the hero scene. A timed timeline that walks a data packet
        down the leak path, taints the agent, exfiltrates, then blocks it when
        the fix is applied. Replayable; reduced-motion users get the same
        story as a correct static end frame (taint + block state included).
     3. countUp()   — KPI numbers count from 0 to their exact printed string
        when revealed; reduced-motion users see the final value immediately.
     4. copyButtons() — a Copy affordance on every code block, injected only
        when the browser can actually put text on the clipboard.

   The scene is the point. It is a story with a beginning, a turn, and an end,
   and it can be replayed. It degrades to a static correct frame if JS is off
   (every element it touches has a sane initial state in the markup).
   ========================================================================== */
(function () {
  "use strict";

  // arm the CSS reveal system only when JS is actually running
  document.documentElement.classList.add("js");

  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // one easing family for everything the eye follows
  var EASE_TRAVEL = "cubic-bezier(.22,.61,.36,1)";

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

  // each stop: [target, narration, tone]
  var SCRIPT = [
    { at: "issue",   text: "A stranger hides an instruction in a public issue.", tone: "untrusted" },
    { at: "github",  text: "Your agent reads it. It cannot tell your words from theirs.", tone: "untrusted" },
    { at: "context", text: "The instruction is now sitting in your agent's memory.", tone: "sink" },
    { at: "fs",      text: "The agent reads your private files \u2014 for a real reason.", tone: "private" },
    { at: "priv",    text: "Private data and a stranger's words are in the same place.", tone: "private" },
    { at: "git",     text: "The agent pushes. Nothing looks wrong at any step.", tone: "danger" },
    { at: "pub",     text: "Your secrets are public. No single tool misbehaved.", tone: "danger" }
  ];

  function AttackPlay(root) {
    var svg      = root.querySelector("[data-scene]");
    if (!svg) return null;

    var packet   = root.querySelector("[data-packet]");
    var trail    = root.querySelector("[data-trail]");
    var gate     = root.querySelector("[data-gate]");
    var alarm    = root.querySelector("[data-alarm]");
    var caption  = root.querySelector("[data-caption]");
    var stepEl   = root.querySelector("[data-step]");
    var replay   = root.querySelector("[data-replay]");
    var nodes    = {};
    root.querySelectorAll("[data-node]").forEach(function (n) {
      nodes[n.getAttribute("data-node")] = n;
    });
    // the tainted-context hook: explicit data-ctx if present, else the context node
    var ctx = root.querySelector("[data-ctx]") || nodes["context"];

    var timers = [];
    var done = false;

    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
    }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

    // the full route, as the trail polyline walks it — one source of truth
    function trailPath() {
      var d = "";
      SCRIPT.forEach(function (stop) {
        var p = PATH[stop.at];
        if (!p) return;
        d += (d ? " L" : "M") + p.x + " " + p.y;
      });
      return d;
    }

    function reset() {
      clear();
      done = false;
      root.classList.remove("blocked", "exploited");
      if (packet) {
        packet.style.transition = "none";
        packet.setAttribute("transform", "translate(" + PATH.issue.x + "," + PATH.issue.y + ")");
        packet.style.opacity = "0";
      }
      if (trail) { trail.setAttribute("d", ""); trail.style.opacity = "0"; }
      if (gate)  { gate.style.opacity = "0"; gate.classList.remove("slam"); }
      if (alarm) { alarm.style.opacity = "0"; alarm.classList.remove("pulse"); }
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove("lit", "tainted"); });
      if (caption) { caption.textContent = "Ready."; caption.setAttribute("data-tone", ""); }
      if (stepEl) stepEl.textContent = "0 / " + SCRIPT.length;
    }

    /* The end of the story, as one static frame: every node lit, the context
       tainted, the route drawn, the gate closed, the danger legs grey.
       Used verbatim for reduced motion and for the first paint after Replay. */
    function endFrame() {
      clear();
      root.classList.remove("exploited");
      root.classList.add("blocked");
      SCRIPT.forEach(function (stop) {
        var node = nodes[stop.at];
        if (!node) return;
        node.classList.add("lit");
        if (stop.tone === "sink") node.classList.add("tainted");
      });
      if (ctx) ctx.classList.add("tainted");
      if (trail) { trail.setAttribute("d", trailPath()); trail.style.opacity = "1"; }
      if (packet) packet.style.opacity = "0";
      if (gate) { gate.style.opacity = "1"; gate.classList.add("slam"); }
      if (alarm) { alarm.style.opacity = "0"; alarm.classList.remove("pulse"); }
      if (caption) {
        caption.textContent = "Revoke one grant. The route is gone.";
        caption.setAttribute("data-tone", "safe");
      }
      if (stepEl) stepEl.textContent = SCRIPT.length + " / " + SCRIPT.length;
      done = true;
    }

    function moveTo(key, ms, leaveTrail) {
      var p = PATH[key];
      if (!packet) return;
      packet.style.transition = "transform " + ms + "ms " + EASE_TRAVEL + ", opacity 200ms ease";
      packet.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
      // the trail grows behind the packet: the segment lands when it arrives
      if (leaveTrail !== false && trail) {
        later(function () {
          var d = trail.getAttribute("d") || "";
          trail.setAttribute("d", d + (d ? " L" : "M") + p.x + " " + p.y);
          trail.style.opacity = "1";
        }, ms - 30);
      }
    }

    function play() {
      reset();
      if (reduced) { endFrame(); return; }

      later(function () {
        if (packet) {
          packet.style.transition = "opacity 220ms ease";
          packet.style.opacity = "1";
        }
      }, 240);

      SCRIPT.forEach(function (stop, i) {
        var stepAt = 520 + i * 900;

        later(function () {
          moveTo(stop.at, 820);
          var node = nodes[stop.at];
          if (node) {
            node.classList.add("lit");
            if (stop.tone === "sink") node.classList.add("tainted");
          }
          if (caption) {
            caption.textContent = stop.text;
            caption.setAttribute("data-tone", stop.tone);
          }
          if (stepEl) stepEl.textContent = (i + 1) + " / " + SCRIPT.length;
        }, stepAt);

        // the turn of the story: the context pulses poisoned, and stays tainted
        if (stop.at === "context" && ctx) {
          later(function () {
            ctx.classList.add("tainted");
            if (alarm) {
              alarm.style.opacity = "1";
              alarm.classList.remove("pulse");
              void alarm.getBoundingClientRect(); // restart the pulse on replay
              alarm.classList.add("pulse");
            }
          }, stepAt + 340);
        }
      });

      var end = 520 + SCRIPT.length * 900;
      later(function () {
        root.classList.add("exploited");
        if (caption) caption.textContent = "That is the leak. Now the fix.";
      }, end);

      // the fix: the gate slams shut, the packet is refused, the route goes grey
      later(function () {
        if (gate) { gate.style.opacity = "1"; gate.classList.add("slam"); }
        if (caption) {
          caption.textContent = "Revoke one grant. The route is gone.";
          caption.setAttribute("data-tone", "safe");
        }
      }, end + 1400);

      later(function () {
        if (packet) {
          packet.style.transition =
            "transform 300ms " + EASE_TRAVEL + ", opacity 320ms ease";
          packet.setAttribute("transform", "translate(" + PATH.git.x + "," + PATH.git.y + ")");
        }
      }, end + 1560);

      later(function () {
        if (packet) {
          packet.style.transition =
            "transform 340ms " + EASE_TRAVEL + ", opacity 320ms ease";
          packet.setAttribute("transform", "translate(" + PATH.fs.x + "," + PATH.fs.y + ")");
        }
      }, end + 1900);

      later(function () {
        if (packet) packet.style.opacity = "0";
        root.classList.add("blocked");
        if (alarm) alarm.style.opacity = "0";
        done = true;
      }, end + 2300);
    }

    if (replay) {
      replay.disabled = false;
      replay.addEventListener("click", function () { play(); });
    }

    // autoplay when scrolled into view, once
    if (reduced) {
      // correct static end frame; Replay keeps working and re-renders it
      endFrame();
    } else if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !done) {
            play();
            io.disconnect();
          }
        });
      }, { threshold: 0.35 });
      io.observe(root);
    } else {
      play();
    }

    return { play: play, reset: reset, endFrame: endFrame };
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
      var t0 = null;
      var DUR = 900;
      function frame(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / DUR, 1);
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
  function copyButtons() {
    var boxes = document.querySelectorAll(".code");
    if (!boxes.length) return;

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
        function settle(ok) {
          if (!ok) return;
          btn.textContent = "Copied";
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { btn.textContent = "Copy"; }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { settle(true); },
            function () { settle(legacyCopy(text)); }
          );
        } else {
          settle(legacyCopy(text));
        }
      });

      box.appendChild(btn);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
