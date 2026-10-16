/* ==========================================================================
   LethalPath — animation engine. No dependencies, no network.

   Two systems:
     1. reveal()  — scroll-triggered entrances via IntersectionObserver
     2. AttackPlay — the hero scene. A timed timeline that walks a data packet
        down the leak path, taints the agent, exfiltrates, then blocks it when
        the fix is applied.

   The scene is the point. It is a story with a beginning, a turn, and an end,
   and it can be replayed. It degrades to a static correct frame if JS is off
   (every element it touches has a sane initial state in the markup).
   ========================================================================== */
(function () {
  "use strict";

  var reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
     Node geometry mirrors the SVG in index.html. Keeping it here means the
     animation and the drawing can never disagree about where things are.
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
    var ctx      = root.querySelector("[data-ctx]");
    var gate     = root.querySelector("[data-gate]");
    var alarm    = root.querySelector("[data-alarm]");
    var caption  = root.querySelector("[data-caption]");
    var stepEl   = root.querySelector("[data-step]");
    var replay   = root.querySelector("[data-replay]");
    var nodes    = {};
    root.querySelectorAll("[data-node]").forEach(function (n) {
      nodes[n.getAttribute("data-node")] = n;
    });

    var timers = [];
    var done = false;

    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
    }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

    function reset() {
      clear();
      done = false;
      root.classList.remove("blocked");
      if (packet) {
        packet.setAttribute("transform", "translate(" + PATH.issue.x + "," + PATH.issue.y + ")");
        packet.style.opacity = "0";
      }
      if (trail) { trail.setAttribute("d", ""); trail.style.opacity = "0"; }
      if (gate)  { gate.style.opacity = "0"; }
      if (alarm) { alarm.style.opacity = "0"; }
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove("lit", "tainted"); });
      if (caption) caption.textContent = "Ready.";
      if (stepEl) stepEl.textContent = "0 / " + SCRIPT.length;
      if (replay) replay.disabled = false;
    }

    function moveTo(key, ms) {
      var p = PATH[key];
      if (!packet) return;
      packet.style.transition = "transform " + ms + "ms cubic-bezier(.5,.02,.3,1), opacity 200ms ease";
      packet.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
      // leave a growing trail behind the packet
      if (trail) {
        var d = trail.getAttribute("d") || "";
        trail.setAttribute("d", d + (d ? " L" : "M") + p.x + " " + p.y);
        trail.style.opacity = "1";
      }
    }

    function play() {
      reset();
      var t = 0;

      later(function () {
        if (packet) packet.style.opacity = "1";
      }, 260);

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

        // the context node starts glowing once tainted, and stays tainted
        if (stop.at === "context" && ctx) {
          later(function () {
            ctx.classList.add("tainted");
            if (alarm) alarm.style.opacity = "1";
          }, stepAt + 300);
        }
      });

      var end = 520 + SCRIPT.length * 900;
      later(function () {
        root.classList.add("exploited");
        if (caption) caption.textContent = "That is the leak. Now the fix.";
      }, end);

      // the fix: a gate closes, the packet is refused, the path goes grey
      later(function () {
        if (gate) gate.style.opacity = "1";
        if (packet) {
          packet.style.transition = "transform 420ms cubic-bezier(.3,0,.2,1), opacity 320ms ease";
          packet.setAttribute("transform", "translate(" + PATH.fs.x + "," + PATH.fs.y + ")");
        }
        if (caption) {
          caption.textContent = "Revoke one grant. The route is gone.";
          caption.setAttribute("data-tone", "safe");
        }
      }, end + 1500);

      later(function () {
        if (packet) packet.style.opacity = "0";
        root.classList.add("blocked");
        if (alarm) alarm.style.opacity = "0";
        if (replay) replay.disabled = false;
        done = true;
      }, end + 2200);
    }

    if (replay) {
      replay.addEventListener("click", function () { play(); });
    }

    // autoplay when scrolled into view, once
    if (reduced) {
      // show the end state immediately; no motion
      root.classList.add("blocked");
      if (caption) caption.textContent = "Revoke one grant. The route is gone.";
      if (stepEl) stepEl.textContent = SCRIPT.length + " / " + SCRIPT.length;
      if (gate) gate.style.opacity = "1";
      done = true;
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

    return { play: play, reset: reset };
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    reveal();
    document.querySelectorAll("[data-attack]").forEach(AttackPlay);

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
