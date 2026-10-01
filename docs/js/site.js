/* Equip landing page — mock player + visualizer demo */

(function () {
  "use strict";

  var TRACKS = [
    { t: "Nightingale", a: "Cobalt Sky", d: 192 },
    { t: "Slow Motion", a: "Arcades", d: 245 },
    { t: "Neon Rain", a: "Vesper Drive", d: 220 },
    { t: "Glass House", a: "Mono Echo", d: 203 },
    { t: "Midnight FM", a: "The Loungers", d: 214 },
    { t: "Paper Planes", a: "Kite & Co.", d: 178 }
  ];

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var mock = document.getElementById("mock");
  var visEl = document.getElementById("mockVis");
  var waveEl = document.getElementById("wave");
  var titleEl = document.getElementById("mockTitle");
  var artistEl = document.getElementById("mockArtist");
  var timeEl = document.getElementById("mockTime");
  var durEl = document.getElementById("mockDur");
  var fillEl = document.getElementById("mockProgressFill");
  var playBtn = document.getElementById("mockPlay");
  var prevBtn = document.getElementById("mockPrev");
  var nextBtn = document.getElementById("mockNext");
  var xfBtn = document.getElementById("mockCrossfade");
  var popTitle = document.getElementById("popTitle");
  var popArtist = document.getElementById("popArtist");

  var state = {
    idx: 0,
    cur: 42,
    playing: true,
    crossfade: 12,
    last: 0
  };

  /* ---------- helpers ---------- */

  function fmt(s) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function track() {
    return TRACKS[state.idx];
  }

  function renderTrack() {
    var tr = track();
    titleEl.textContent = tr.t;
    artistEl.textContent = tr.a;
    durEl.textContent = fmt(tr.d);
    popTitle.textContent = tr.t;
    popArtist.textContent = tr.a;
    fillEl.style.width = "0%";
  }

  /* ---------- visualizer bars ---------- */

  var VIS_BARS = 34;
  var WAVE_BARS = 64;

  var visBars = [];
  var waveBars = [];

  function makeBars(container, count, ctor) {
    for (var i = 0; i < count; i++) {
      var b = document.createElement("i");
      container.appendChild(b);
      var meta = ctor(i, count);
      if (container === visEl) visBars.push({ el: b, ph: meta.ph, fr: meta.fr });
      else if (container === waveEl) waveBars.push({ el: b, ph: meta.ph, fr: meta.fr });
    }
  }

  function barMeta(i, n, spread) {
    var ph = (i / n) * Math.PI * spread;
    return { ph: ph, fr: 0.9 + ((i * 7) % 11) / 9 };
  }

  function buildVis() {
    makeBars(visEl, VIS_BARS, function (i) {
      return barMeta(i, VIS_BARS, 6);
    });
  }

  function buildWave() {
    makeBars(waveEl, WAVE_BARS, function (i) {
      return barMeta(i, WAVE_BARS, 3.2);
    });
  }

  function barHeight(meta, t, energy, staticVal) {
    if (reduced) return staticVal;
    var s =
      Math.sin(t * 1.6 * meta.fr + meta.ph) * 0.55 +
      Math.sin(t * 3.1 * meta.fr + meta.ph * 2.1) * 0.3 +
      Math.sin(t * 0.7 + meta.ph * 3.7) * 0.15;
    s = (s + 1.3) / 2.6; // fit roughly 0..1
    s = Math.max(0.06, Math.min(1, s));
    return 8 + s * 88 * energy;
  }

  /* ---------- animation loop ---------- */

  var tPrev = 0;

  function frame(now) {
    var dt = Math.min(0.06, (now - tPrev) / 1000 || 0);
    tPrev = now;
    var t = now / 1000;

    /* progress */
    if (state.playing) {
      state.cur += dt;
      if (state.cur >= track().d) {
        /* crossfade-style advance */
        mock.classList.remove("xf");
        void mock.offsetWidth;
        mock.classList.add("xf");
        setTimeout(function () {
          mock.classList.remove("xf");
        }, 900);
        state.idx = (state.idx + 1) % TRACKS.length;
        state.cur = 0;
        renderTrack();
      }
      timeEl.textContent = fmt(state.cur);
      fillEl.style.width = ((state.cur / track().d) * 100).toFixed(1) + "%";
    } else {
      timeEl.textContent = fmt(state.cur);
    }

    /* visualizer */
    var energy = state.playing ? 1 : 0.34;
    for (var i = 0; i < visBars.length; i++) {
      var v = visBars[i];
      v.el.style.height = barHeight(v, t, energy, 22 + Math.sin(v.ph) * 14) + "%";
    }

    /* waveform in the SoundCloud section */
    var wEnergy = 0.55 + 0.45 * energy;
    for (var j = 0; j < waveBars.length; j++) {
      var w = waveBars[j];
      w.el.style.height =
        barHeight(w, t * 1.15 + j * 0.16, wEnergy, 26 + Math.sin(w.ph) * 12) + "%";
    }

    if (!reduced) requestAnimationFrame(frame);
  }

  /* ---------- controls ---------- */

  function setPlaying(on) {
    state.playing = on;
    playBtn.textContent = on ? "⏸" : "▶";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    mock.classList.toggle("playing", on);
    if (reduced) tPrev = performance.now();
  }

  playBtn.addEventListener("click", function () {
    setPlaying(!state.playing);
  });

  function step(delta) {
    state.idx = (state.idx + delta + TRACKS.length) % TRACKS.length;
    state.cur = 0;
    renderTrack();
  }

  nextBtn.addEventListener("click", function () {
    step(1);
  });

  prevBtn.addEventListener("click", function () {
    step(-1);
  });

  xfBtn.addEventListener("click", function () {
    state.crossfade = state.crossfade === 0 ? 12 : 0;
    xfBtn.classList.toggle("on", state.crossfade > 0);
    xfBtn.title = state.crossfade > 0 ? "Crossfade " + state.crossfade + "s" : "Crossfade off";
  });

  /* ---------- accent preview ---------- */

  var swatches = document.querySelectorAll(".swatch");
  swatches.forEach(function (sw) {
    sw.addEventListener("click", function () {
      document.documentElement.style.setProperty("--accent", sw.dataset.accent);
      swatches.forEach(function (s) {
        s.classList.toggle("is-active", s === sw);
      });
    });
  });

  /* ---------- init ---------- */

  buildVis();
  buildWave();
  renderTrack();
  mock.classList.add("playing");
  playBtn.textContent = "⏸";
  timeEl.textContent = fmt(state.cur);
  fillEl.style.width = "22%";

  if (reduced) {
    /* static render, one pulse of the loop to set heights */
    frame(performance.now());
  } else {
    requestAnimationFrame(frame);
  }
})();