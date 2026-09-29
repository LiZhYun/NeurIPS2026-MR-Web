/*
  Chapters 4 and 5: the SIF explanation, the tap or hover text of the fourteen-method chart.
  (The bars of both charts grow through bars.js; this file only adds what bars.js does not.)

  SIF explanation (#sif-steps, four beats through steps.js)
  - Left: three source clips of a made-up four-legged creature (the hero's trot, creep and bounding
    stride), placed on a triangle. Right: their outputs on a two-legged figure, on the same triangle, so
    the output in each corner answers the source in the same corner. On narrow stages (phones) the
    outputs go under the sources instead.
  - A line joins every pair of clips; its thickness is how different the two clips are.
    Beat 1: the clips. Beat 2: the source lines draw in, with a small key.
    Beat 3: a faithful model; the output lines draw in with the same thicknesses; meter "SIF near 1".
    Beat 4: a model that ignores the source; its outputs change, their lines keep varied thicknesses
    that no longer follow the source lines; the meter drops to "SIF near 0".
  - The figures walk in place while the picture is on screen; with reduced motion each one holds a pose.
  - The SVG is drawn in screen pixels (its viewBox is its own width), so text sizes in scores.css are
    real sizes. It is rebuilt when its width changes.

  Fourteen-method chart (.sx-chart): hovering, focusing or tapping a row shows its name and tap text
  (data-tip) next to its interval. A second tap, a tap elsewhere or Escape hides it.
*/
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var TAU = Math.PI * 2;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- helpers ---------- */

  function el(tag, attrs, parent, text) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function clamp01(x) { return clamp(x, 0, 1); }
  function easeInOut(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function span(p, a, b) { return easeInOut((p - a) / (b - a)); }  // eased 0..1 as p goes from a to b
  function lerp(a, b, t) { return a + (b - a) * t; }
  function f1(v) { return Math.round(v * 10) / 10; }
  function pt(p) { return f1(p[0]) + ' ' + f1(p[1]); }
  function frac(x) { return x - Math.floor(x); }
  function add(p, q, s) { return [p[0] + q[0] * s, p[1] + q[1] * s]; }
  function dirUp(a) { return [Math.cos(a), -Math.sin(a)]; }
  function dirDown(a) { return [Math.sin(a), Math.cos(a)]; }
  function opacity(node, v) { node.setAttribute('opacity', v >= 0.999 ? 1 : f1(v * 100) / 100); }

  /* ---------- figures (same walking model as the hero) ---------- */

  function footPath(p, g, lift) {
    p = frac(p);
    var d = g.duty, s = g.stride;
    if (p < d) return [s * (0.5 - p / d), 0, true];
    var u = (p - d) / (1 - d);
    var sn = Math.sin(Math.PI * u);
    return [s * (easeInOut(u) - 0.5), -(lift || g.lift) * Math.pow(sn, 1.4), false];
  }
  function solve(root, end, a, b, bend) {
    var dx = end[0] - root[0], dy = end[1] - root[1];
    var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var dmax = a + b - 0.01, dmin = Math.abs(a - b) + 0.01;
    if (d > dmax) { end = [root[0] + dx / d * dmax, root[1] + dy / d * dmax]; d = dmax; }
    if (d < dmin) d = dmin;
    var base = Math.atan2(dy, dx);
    var al = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    var ang = base - bend * al;
    return [[root[0] + a * Math.cos(ang), root[1] + a * Math.sin(ang)], end];
  }
  function reach(x, feet, len) {
    var h = Infinity;
    feet.forEach(function (f) {
      if (!f[2]) return;
      var dx = f[0] - x;
      h = Math.min(h, Math.sqrt(Math.max(0, len * len - dx * dx)));
    });
    return h;
  }
  function bumps(phi, list) {
    var y = 0;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(frac(phi - list[i][0] + 0.5) - 0.5);
      if (d < list[i][1]) y += list[i][2] * 0.5 * (1 + Math.cos(Math.PI * d / list[i][1]));
    }
    return y;
  }
  function limbD(root, r) { return 'M' + pt(root) + ' L' + pt(r[0]) + ' L' + pt(r[1]); }

  var CREATURE = {
    trot: {
      period: 680, duty: 0.44, stride: 26, lift: 12,
      len: 70, stretch: 0, hipH: 45, shH: 46, lift2: [[0.22, 0.22, 5], [0.72, 0.22, 5]],
      upF: 27, lowF: 22, upH: 30, lowH: 20, arch: 5, archSwing: 0, rootF: 2, rootH: 0,
      neck: 24, neckAng: 1.0, headTilt: 0.8, nod: 0.08, tail: 28, tailAng: 0.7, tailCurve: -0.5, sway: 0.12,
      legs: { HL: 0, FR: 0.02, HR: 0.5, FL: 0.52 }, still: 0.62
    },
    creep: {
      period: 1500, duty: 0.76, stride: 13, lift: 5,
      len: 72, stretch: 0, hipH: 21, shH: 26, lift2: [[0.12, 0.2, 0.8], [0.62, 0.2, 0.8]],
      upF: 19, lowF: 22, upH: 19, lowH: 22, bendF: -1, bendH: 1, arch: -3, archSwing: 0, rootF: 6, rootH: -4,
      neck: 22, neckAng: -0.05, headTilt: 0.15, nod: 0.03, tail: 38, tailAng: -0.12, tailCurve: 0.25, sway: 0.06,
      legs: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, still: 0.18
    },
    bound: {
      period: 900, duty: 0.3, stride: 66, lift: 8, liftF: 11, liftH: 12,
      len: 92, stretch: 0.14, stretchPh: 0.36, hipH: 41, shH: 40,
      lift2: [[0.37, 0.1, 6], [0.88, 0.16, 10]],
      upF: 24, lowF: 22, upH: 26, lowH: 22, bendF: -1, arch: 2, archSwing: 3, rootF: 6, rootH: -4,
      neck: 26, neckAng: 0.05, headTilt: 0.55, nod: 0.08, tail: 40, tailAng: 0.08, tailCurve: 0.12, sway: 0.08,
      legs: { HL: 0, HR: 0.04, FL: 0.42, FR: 0.46 }, still: 0.36
    }
  };
  var C_HEAD = 7.5;

  function Creature(parent, g) {
    this.g = g;
    this.shadow = el('ellipse', { 'class': 'sx-shadow', cx: 0, cy: 2, rx: 50, ry: 4 }, parent);
    var far = el('g', { 'class': 'hx-far' }, parent);
    this.farLegs = [el('path', { 'class': 'hx-line' }, far), el('path', { 'class': 'hx-line' }, far)];
    this.tail = el('path', { 'class': 'hx-line' }, parent);
    this.spine = el('path', { 'class': 'hx-line hx-thick' }, parent);
    this.neck = el('path', { 'class': 'hx-line hx-thick' }, parent);
    this.head = el('ellipse', { 'class': 'hx-fillink', rx: C_HEAD * 1.3, ry: C_HEAD * 0.82 }, parent);
    this.nearLegs = [el('path', { 'class': 'hx-line' }, parent), el('path', { 'class': 'hx-line' }, parent)];
  }
  Creature.prototype.update = function (phi) {
    var g = this.g;
    var st = g.stretch ? Math.cos(TAU * (phi - g.stretchPh)) : 0;
    var len = g.len * (1 + g.stretch * st);
    var hipX = -len / 2, shX = len / 2;
    var feet = {};
    ['HL', 'HR', 'FL', 'FR'].forEach(function (key) {
      var front = key.charAt(0) === 'F';
      var f = footPath(phi + g.legs[key], g, front ? g.liftF : g.liftH);
      var rest = front ? g.len / 2 + g.rootF : -g.len / 2 + g.rootH;
      feet[key] = [rest + f[0], f[1], f[2]];
    });
    var up = bumps(phi, g.lift2);
    var hipY = Math.min(g.hipH + up, reach(hipX, [feet.HL, feet.HR], (g.upH + g.lowH) * 0.99));
    var shY = Math.min(g.shH + up, reach(shX, [feet.FL, feet.FR], (g.upF + g.lowF) * 0.99));
    var hip = [hipX, -hipY], sh = [shX, -shY];
    var arch = g.arch - g.archSwing * st;
    this.spine.setAttribute('d', 'M' + pt(hip) + ' C' + pt([hipX + len * 0.3, hip[1] - arch]) + ' ' +
      pt([shX - len * 0.3, sh[1] - arch]) + ' ' + pt(sh));
    var na = g.neckAng + g.nod * Math.sin(TAU * 2 * phi);
    var nEnd = add(sh, dirUp(na), g.neck);
    var nMid = add(add(sh, dirUp(na), g.neck * 0.5), dirUp(na + Math.PI / 2), 3);
    this.neck.setAttribute('d', 'M' + pt(sh) + ' Q' + pt(nMid) + ' ' + pt(nEnd));
    var ha = na - g.headTilt;
    var hc = add(nEnd, dirUp(ha), C_HEAD * 0.9);
    this.head.setAttribute('transform', 'translate(' + pt(hc) + ') rotate(' + f1(-ha * 180 / Math.PI) + ')');
    var ta = g.tailAng + g.sway * Math.sin(TAU * 2 * phi + 1);
    var tEnd = add(hip, dirUp(Math.PI - ta), g.tail);
    var tCtl = add(hip, dirUp(Math.PI - ta - g.tailCurve), g.tail * 0.6);
    var back = [-len * 0.3, arch], bl = Math.hypot(back[0], back[1]);
    var tRoot = add(hip, [back[0] / bl, back[1] / bl], g.tail * 0.3);
    this.tail.setAttribute('d', 'M' + pt(hip) + ' C' + pt(tRoot) + ' ' + pt(tCtl) + ' ' + pt(tEnd));
    function leg(node, key) {
      var front = key.charAt(0) === 'F', root = front ? sh : hip;
      node.setAttribute('d', limbD(root, front ? solve(root, feet[key], g.upF, g.lowF, g.bendF || 1) : solve(root, feet[key], g.upH, g.lowH, g.bendH || -1)));
    }
    leg(this.farLegs[0], 'HR'); leg(this.farLegs[1], 'FR');
    leg(this.nearLegs[0], 'HL'); leg(this.nearLegs[1], 'FL');
    var rise = clamp01(((hipY + shY) / 2 - Math.min(g.hipH, g.shH) + 2) / 12);
    this.shadow.setAttribute('rx', f1((len / 2 + 14) * (1 - 0.3 * rise)));
  };

  var WALKER = {
    bouncy: { period: 680, duty: 0.52, stride: 24, lift: 19, hipH: 44, bob: [[0.13, 0.2, 5], [0.63, 0.2, 5]],
      lean: -0.02, head: 0.05, arm: 0.85, armBias: 0.2, elbow: 0.9, still: 0.4 },
    crouch: { period: 1500, duty: 0.66, stride: 13, lift: 4, hipH: 34, bob: [[0.16, 0.2, 0.6], [0.66, 0.2, 0.6]],
      lean: 0.52, head: -0.35, arm: 0.22, armBias: 0.45, elbow: 1.0, still: 0.1 },
    long: { period: 920, duty: 0.58, stride: 54, lift: 10, hipH: 43, bob: [[0.15, 0.2, 2], [0.65, 0.2, 2]],
      lean: 0.26, head: -0.12, arm: 1.1, armBias: 0.05, elbow: 0.35, still: 0.02 },
    average: { period: 1000, duty: 0.6, stride: 26, lift: 7, hipH: 44, bob: [[0.15, 0.2, 1.5], [0.65, 0.2, 1.5]],
      lean: 0.06, head: 0, arm: 0.5, armBias: 0.05, elbow: 0.3, still: 0.02 }
  };
  var THIGH = 23, SHIN = 23, TORSO = 31, NECK = 7, W_HEAD = 8.5, UPPER = 18, FORE = 16;

  function Walker(parent, g) {
    this.g = g;
    this.shadow = el('ellipse', { 'class': 'sx-shadow', cx: 0, cy: 2, rx: 22, ry: 4 }, parent);
    var far = el('g', { 'class': 'hx-far' }, parent);
    this.farArm = el('path', { 'class': 'hx-line' }, far);
    this.farLeg = el('path', { 'class': 'hx-line' }, far);
    this.torso = el('path', { 'class': 'hx-line hx-thick' }, parent);
    this.head = el('circle', { 'class': 'hx-fillink', r: W_HEAD }, parent);
    this.nearLeg = el('path', { 'class': 'hx-line' }, parent);
    this.nearArm = el('path', { 'class': 'hx-line' }, parent);
  }
  Walker.prototype.update = function (phi) {
    var g = this.g, L = THIGH + SHIN;
    var nf = footPath(phi, g), ff = footPath(phi + 0.5, g);
    var shift = g.lean * 8;
    nf[0] += shift; ff[0] += shift;
    var hipY = Math.min(g.hipH + bumps(phi, g.bob), reach(0, [nf, ff], L * 0.99));
    var pelvis = [0, -hipY];
    var up = [Math.sin(g.lean), -Math.cos(g.lean)];
    var chest = add(pelvis, up, TORSO);
    var shoulder = add(pelvis, up, TORSO - 4);
    var mid = add(add(pelvis, up, TORSO * 0.5), [-up[1], up[0]], -2.5);
    this.torso.setAttribute('d', 'M' + pt(pelvis) + ' Q' + pt(mid) + ' ' + pt(chest) +
      ' L' + pt(add(chest, dirDown(Math.PI - g.lean - g.head), NECK)));
    var hc = add(chest, dirDown(Math.PI - g.lean - g.head), NECK + W_HEAD + 1.5);
    this.head.setAttribute('cx', f1(hc[0]));
    this.head.setAttribute('cy', f1(hc[1]));
    this.nearLeg.setAttribute('d', limbD(pelvis, solve(pelvis, nf, THIGH, SHIN, 1)));
    this.farLeg.setAttribute('d', limbD(pelvis, solve(pelvis, ff, THIGH, SHIN, 1)));
    function armD(a) {
      var ua = a + g.armBias + g.lean * 0.5;
      var elbow = add(shoulder, dirDown(ua), UPPER);
      var hand = add(elbow, dirDown(Math.min(ua + g.elbow, 0.95)), FORE);
      return 'M' + pt(shoulder) + ' L' + pt(elbow) + ' L' + pt(hand);
    }
    var swing = -g.arm * Math.cos(TAU * (phi - g.duty / 2 + 0.25));
    this.nearArm.setAttribute('d', armD(swing));
    this.farArm.setAttribute('d', armD(-swing));
  };

  /* ---------- the SIF explanation ---------- */

  // Corners of each triangle: 0 top, 1 bottom left, 2 bottom right. Pairs in this order: 0-1, 0-2, 1-2.
  var PAIRS = [[0, 1], [0, 2], [1, 2]];
  var SOURCES = [CREATURE.trot, CREATURE.creep, CREATURE.bound];
  var SOURCE_NAMES = ['Source 1', 'Source 2', 'Source 3'];
  // How different each pair of clips is, 0 to 1 (drawn as line thickness).
  var SRC_DIFF = [0.9, 0.3, 0.6];
  // The faithful model: each output keeps its source's style, so its lines match.
  var FAITHFUL = [WALKER.bouncy, WALKER.crouch, WALKER.long];
  var FAITHFUL_DIFF = [0.88, 0.32, 0.6];
  // A model that ignores the source: its outputs still differ, but not in the sources' pattern
  // (the two most alike sources, 1 and 3, get the two most different outputs).
  var IGNORES = [WALKER.average, WALKER.bouncy, WALKER.crouch];
  var IGNORES_DIFF = [0.4, 0.45, 0.95];
  var METER = { faithful: 0.96, ignores: 0.04 };

  var live = [];         // stages whose figures walk: { svg, figs, onScreen }
  var raf = 0, clock = 0, lastT = null;

  function frame(now) {
    raf = 0;
    if (lastT !== null) clock += Math.min(now - lastT, 50);
    lastT = now;
    var any = false;
    live.forEach(function (s) {
      if (!s.onScreen || !s.svg.isConnected) return;
      any = true;
      s.figs.forEach(function (f) { f.fig.update(frac(clock / f.g.period)); });
    });
    if (any && !document.hidden && !REDUCED.matches) raf = requestAnimationFrame(frame);
    else lastT = null;
  }
  function wake() {
    if (!raf && !REDUCED.matches && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function poseAll() {
    live.forEach(function (s) { s.figs.forEach(function (f) { f.fig.update(f.g.still); }); });
  }
  document.addEventListener('visibilitychange', wake);
  if (REDUCED.addEventListener) REDUCED.addEventListener('change', function () { if (REDUCED.matches) poseAll(); else wake(); });

  var watcher = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      live.forEach(function (s) { if (s.svg === e.target) s.onScreen = e.isIntersecting; });
    });
    wake();
  }) : null;

  // A figure's extent over a whole step cycle, in its own units: [x1, x2, y1, y2].
  function extent(g, fig, style) {
    var x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    for (var q = 0; q < 1; q += 0.1) {
      fig.update(q);
      var bb = g.getBBox();
      x1 = Math.min(x1, bb.x); x2 = Math.max(x2, bb.x + bb.width);
      y1 = Math.min(y1, bb.y); y2 = Math.max(y2, bb.y + bb.height);
    }
    fig.update(style.still);
    return [x1, x2, y1, y2];
  }
  // Place a figure at scale s so the centre of its extent sits at c.
  function place(g, e, c, s) {
    g.setAttribute('transform', 'translate(' + f1(c[0] - (e[0] + e[1]) / 2 * s) + ' ' + f1(c[1] - (e[2] + e[3]) / 2 * s) +
      ') scale(' + f1(s * 100) / 100 + ')');
  }

  // A line from corner a to corner b, stopping short of the figures (an ellipse round each corner).
  function trimmed(a, b, ra, rb) {
    var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    function cut(r) { return 1 / Math.sqrt(ux * ux / (r[0] * r[0]) + uy * uy / (r[1] * r[1])); }
    var ca = cut(ra), cb = cut(rb);
    return 'M' + pt([a[0] + ux * ca, a[1] + uy * ca]) + ' L' + pt([b[0] - ux * cb, b[1] - uy * cb]);
  }

  // Two layouts. Wide stages: sources on the left, outputs on the right. Narrow stages (phones): the
  // outputs go under the sources, so each triangle gets the full width and every pair line stays long
  // enough to compare. Both triangles have the same corners across, so the shapes match.
  function build(stage, W) {
    var st = stage.__sx;
    var svg = st.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var small = W < 480;
    stage.classList.toggle('is-small', small);
    var k = small ? clamp(W / 360, 0.85, 1.1) : clamp(W / 600, 0.8, 1.15);
    var pad = Math.round((small ? 16 : 26) * k);
    var mid = Math.round(44 * k);
    var cS = (small ? 0.5 : 0.56) * k, wS = (small ? 0.66 : 1) * k;
    var labelGap = small ? 18 : 20;

    var gLines = el('g', {}, svg);
    var gFigs = el('g', {}, svg);
    var gText = el('g', {}, svg);

    // The figures, measured before they are placed.
    st.figs = [];
    st.src = []; st.faithful = []; st.ignores = [];
    var srcFigs = SOURCES.map(function (style) {
      var g = el('g', { 'class': 'hx-src' }, gFigs);
      var fig = new Creature(g, style);
      st.figs.push({ fig: fig, g: style });
      return { g: g, e: extent(g, fig, style) };
    });
    var outFigs = [FAITHFUL, IGNORES].map(function (set, n) {
      return set.map(function (style) {
        var g = el('g', { 'class': 'hx-out' }, gFigs);
        var fig = new Walker(g, style);
        st.figs.push({ fig: fig, g: style });
        (n ? st.ignores : st.faithful).push(g);
        return { g: g, e: extent(g, fig, style) };
      });
    });
    function size(e, s) { return [(e[1] - e[0]) * s, (e[3] - e[2]) * s]; }
    st.srcSizes = srcFigs.map(function (f) { return size(f.e, cS); });
    st.outSizes = [0, 1, 2].map(function (i) {
      var a = size(outFigs[0][i].e, wS), b = size(outFigs[1][i].e, wS);
      return [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    });
    var outHalfW = Math.max(st.outSizes[1][0], st.outSizes[2][0]) / 2;
    var lowSrc = Math.max(st.srcSizes[1][1], st.srcSizes[2][1]) / 2;
    var lowOut = Math.max(st.outSizes[1][1], st.outSizes[2][1]) / 2;

    // Corners (0 top, 1 bottom left, 2 bottom right) of a triangle over [x, x + w]: the bottom
    // figures sit at the edges, so the line between them is as long as the room allows.
    function corners(x, w, halfW, top, h) {
      return [[x + w / 2, top], [x + halfW, top + h], [x + w - halfW, top + h]];
    }
    var cs, headX, headY, arrowD, by, keyX, mx, mw;
    if (!small) {
      var avail = W - 2 * pad - mid;
      var gws = [avail * 0.6, avail * 0.4];
      var gx = [pad, pad + gws[0] + mid];
      headY = pad + 16;
      headX = gx[1] + gws[1] / 2;
      var topY = headY + 22 + st.outSizes[0][1] / 2;
      var triH = Math.round(215 * k);
      var srcHalfW = Math.max(st.srcSizes[1][0], st.srcSizes[2][0]) / 2;
      cs = [corners(gx[0], gws[0], srcHalfW, topY, triH), corners(gx[1], gws[1], outHalfW, topY, triH)];
      // One arrow from the sources to the outputs, at the height of the triangles' middle.
      var ay = topY + triH * 0.62, ax0 = gx[0] + gws[0] + mid * 0.12, ax1 = gx[1] - mid * 0.12;
      arrowD = 'M' + f1(ax0) + ' ' + f1(ay) + ' L' + f1(ax1) + ' ' + f1(ay) +
        ' M' + f1(ax1 - 6) + ' ' + f1(ay - 6) + ' L' + f1(ax1) + ' ' + f1(ay) + ' L' + f1(ax1 - 6) + ' ' + f1(ay + 6);
      by = topY + triH + Math.max(lowSrc + labelGap, lowOut) + 44;
      keyX = gx[0];
      mw = gws[1] - 12; mx = gx[1] + 6;
    } else {
      var x = pad, w = W - 2 * pad;
      var srcHalf = Math.max(st.srcSizes[1][0], st.srcSizes[2][0], outHalfW * 2) / 2;
      var sTop = pad + st.srcSizes[0][1] / 2;
      var sH = Math.round(110 * k);
      var srcC = corners(x, w, srcHalf, sTop, sH);
      var labelsY = sTop + sH + lowSrc + labelGap;
      // A short arrow down, then the outputs' heading, then the outputs on the same corners across.
      var ay0 = labelsY + 12, ay1 = ay0 + 22;
      arrowD = 'M' + f1(W / 2) + ' ' + f1(ay0) + ' L' + f1(W / 2) + ' ' + f1(ay1) +
        ' M' + f1(W / 2 - 4) + ' ' + f1(ay1 - 4) + ' L' + f1(W / 2) + ' ' + f1(ay1) + ' L' + f1(W / 2 + 4) + ' ' + f1(ay1 - 4);
      headX = W / 2;
      headY = ay1 + 22;
      var oTop = headY + 12 + st.outSizes[0][1] / 2;
      var oH = Math.round(96 * k);
      cs = [srcC, corners(x, w, srcHalf, oTop, oH)];
      by = oTop + oH + lowOut + 34;
      keyX = pad;
      mx = W / 2 + 8; mw = W - pad - mx;
    }

    SOURCES.forEach(function (style, i) { place(srcFigs[i].g, srcFigs[i].e, cs[0][i], cS); });
    outFigs.forEach(function (set) { set.forEach(function (f, i) { place(f.g, f.e, cs[1][i], wS); }); });

    st.head = el('text', { 'class': 'sx-head-text', x: f1(headX), y: f1(headY), 'text-anchor': 'middle' }, gText, 'Outputs on one target body');
    // Keep the heading inside the stage's padding when it is wider than the outputs' column.
    var headMax = W - pad - st.head.getComputedTextLength() / 2;
    if (headX > headMax) st.head.setAttribute('x', f1(headMax));

    // Labels: each source's under it; the two bottom ones on one baseline.
    SOURCES.forEach(function (style, i) {
      var c = cs[0][i];
      var y = c[1] + (i === 0 ? st.srcSizes[0][1] / 2 : lowSrc) + labelGap;
      st.src.push(el('text', { 'class': 'sx-label', x: f1(c[0]), y: f1(y), 'text-anchor': 'middle' }, gText, SOURCE_NAMES[i]));
    });

    // Pair lines, behind the figures. The lines from the top source start below its label.
    function ellipse(size, below) { return [size[0] / 2 + (below ? 16 : 8) * k, size[1] / 2 + 10 * k + (below ? labelGap + 12 : 0)]; }
    st.lines = [[], []];
    PAIRS.forEach(function (pr) {
      [0, 1].forEach(function (side) {
        var sizes = side ? st.outSizes : st.srcSizes;
        var d = trimmed(cs[side][pr[0]], cs[side][pr[1]], ellipse(sizes[pr[0]], !side && pr[0] === 0), ellipse(sizes[pr[1]]));
        st.lines[side].push(el('path', { 'class': 'sx-pair ' + (side ? 'sx-pair-out' : 'sx-pair-src'), d: d, pathLength: 1 }, gLines));
      });
    });
    st.width = function (diff) { return f1((1.5 + 11 * diff) * clamp(k, 0.75, 1.1)); };
    st.arrow = el('path', { 'class': 'sx-arrow', d: arrowD }, gText);

    // Bottom row: the key on the left, the meter on the right.
    var keyW = Math.round((small ? 26 : 40) * k);
    st.key = el('g', {}, gText);
    [['More different', 1], ['More alike', 0]].forEach(function (row, j) {
      var y = by + j * (small ? 20 : 26);
      el('path', { 'class': 'sx-pair sx-pair-key', d: 'M' + f1(keyX + 6) + ' ' + f1(y) + ' L' + f1(keyX + 6 + keyW) + ' ' + f1(y), 'stroke-width': st.width(row[1]) }, st.key);
      el('text', { 'class': 'sx-key', x: f1(keyX + keyW + (small ? 16 : 22)), y: f1(y + 4.5) }, st.key, row[0]);
    });
    var barH = small ? 7 : 8;
    st.meter = el('g', {}, gText);
    st.meterText = [
      el('text', { 'class': 'sx-meter', x: f1(mx), y: f1(by - 6) }, st.meter, 'SIF near 1'),
      el('text', { 'class': 'sx-meter', x: f1(mx), y: f1(by - 6) }, st.meter, 'SIF near 0')
    ];
    el('rect', { 'class': 'sx-track', x: f1(mx), y: f1(by + 6), width: f1(mw), height: barH, rx: barH / 2 }, st.meter);
    st.meterFill = el('rect', { 'class': 'sx-fill', x: f1(mx), y: f1(by + 6), width: 0, height: barH, rx: barH / 2 }, st.meter);
    st.meterW = mw;

    var H = Math.ceil(by + (small ? 20 : 26) + pad);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    st.builtW = W;
    if (REDUCED.matches) poseAll();
  }

  function paint(stage, beat, p) {
    var st = stage.__sx;
    // Beat 1 (index 0): everything but the lines; the outputs come up as the beat starts.
    var outs = beat === 0 ? 0.25 + 0.75 * span(p, 0, 1) : 1;
    var srcLines = beat < 1 ? 0 : beat === 1 ? span(p, 0, 1) : 1;
    var outLines = beat < 2 ? 0 : beat === 2 ? span(p, 0, 1) : 1;
    var mix = beat < 3 ? 0 : span(p, 0, 1);                 // 0 faithful model, 1 the model that ignores the source

    st.faithful.forEach(function (g) { opacity(g, outs * (1 - mix)); });
    st.ignores.forEach(function (g) { opacity(g, outs * mix); });
    opacity(st.head, outs);
    opacity(st.arrow, outs);

    PAIRS.forEach(function (pr, j) {
      var s = st.lines[0][j], o = st.lines[1][j];
      s.setAttribute('stroke-width', st.width(SRC_DIFF[j]));
      s.setAttribute('stroke-dasharray', f1(srcLines * 1000) / 1000 + ' 1');
      opacity(s, clamp01(srcLines * 6));   // fade in while short, so the round cap is not left as a dot
      o.setAttribute('stroke-width', st.width(lerp(FAITHFUL_DIFF[j], IGNORES_DIFF[j], mix)));
      o.setAttribute('stroke-dasharray', f1(outLines * 1000) / 1000 + ' 1');
      opacity(o, clamp01(outLines * 6));
    });
    opacity(st.key, srcLines);

    var m = outLines * lerp(METER.faithful, METER.ignores, mix);
    st.meterFill.setAttribute('width', f1(st.meterW * m));
    opacity(st.meter, outLines);
    opacity(st.meterText[0], clamp01(1 - 2 * mix));
    opacity(st.meterText[1], clamp01(2 * mix - 1));
  }

  var stepsEl = document.getElementById('sif-steps');
  if (stepsEl && window.Steps) {
    var handle = null;
    var setup = function (stage) {
      var svg = el('svg', { 'aria-hidden': 'true', focusable: 'false' }, stage);
      stage.__sx = { svg: svg, builtW: 0 };
      var W = Math.round(stage.clientWidth);
      if (W) build(stage, W);
      live.push({ svg: svg, figs: stage.__sx.figs || [], onScreen: false, stage: stage });
      if (watcher) watcher.observe(svg); else { live[live.length - 1].onScreen = true; wake(); }
    };
    var draw = function (beat, p, stage) {
      var st = stage.__sx;
      var W = Math.round(stage.clientWidth);
      if (W && W !== st.builtW) {
        build(stage, W);
        live.forEach(function (s) { if (s.svg === st.svg) s.figs = st.figs; });
        // The pinned stage changed height: let steps.js measure it again.
        if (!stage.classList.contains('is-still') && handle) requestAnimationFrame(handle.refresh);
      }
      if (st.builtW) paint(stage, beat, p);
    };
    handle = Steps.mount(stepsEl, { setup: setup, draw: draw });
  }

  /* ---------- tap or hover text on the fourteen-method chart ---------- */

  var chart = document.querySelector('.sx-chart');
  if (chart) {
    var rowsBox = chart.querySelector('.sx-rows');
    var rows = Array.prototype.slice.call(chart.querySelectorAll('.sx-row'));
    var tip = chart.querySelector('.sx-tip');
    var tipName = tip.querySelector('.sx-tip-name');
    var tipText = tip.querySelector('.sx-tip-text');
    var active = null, pinned = false, parkTimer = 0;

    rows.forEach(function (row) {
      var name = row.querySelector('.sx-name').textContent;
      row.setAttribute('aria-label', name + ': ' + row.getAttribute('data-tip'));
    });

    var show = function (row) {
      if (active && active !== row) active.classList.remove('is-active');
      active = row;
      row.classList.add('is-active');
      rowsBox.classList.add('has-active');
      tipName.textContent = row.querySelector('.sx-name').textContent;
      tipText.textContent = row.getAttribute('data-tip');
      // Next to the right end of the interval, or above the row if there is no room there.
      var box = chart.getBoundingClientRect();
      var ci = row.querySelector('.sx-ci').getBoundingClientRect();
      var r = row.getBoundingClientRect();
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var x = ci.right - box.left + 14, y = r.top - box.top + r.height / 2 - th / 2;
      if (x + tw > box.width) {
        x = Math.max(0, Math.min(box.width - tw, ci.left + ci.width / 2 - box.left - tw / 2));
        y = r.top - box.top - th - 4;
      }
      tip.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(y) + 'px)';
      tip.classList.add('is-shown');
    };
    var hide = function () {
      if (active) active.classList.remove('is-active');
      active = null;
      pinned = false;
      rowsBox.classList.remove('has-active');
      tip.classList.remove('is-shown');
      // Once faded out, move it back inside the chart, so a later resize cannot leave it hanging over the edge.
      clearTimeout(parkTimer);
      parkTimer = setTimeout(function () { if (!active) tip.style.transform = ''; }, 250);
    };

    rows.forEach(function (row) {
      row.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' && !pinned) show(row); });
      row.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !pinned) hide(); });
      row.addEventListener('focus', function () { if (!pinned) show(row); });
      row.addEventListener('blur', function () { if (!pinned) hide(); });
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        if (pinned && active === row) { hide(); return; }
        show(row);
        pinned = true;
      });
    });
    document.addEventListener('click', function () { if (pinned) hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && active) hide(); });
    window.addEventListener('resize', function () { if (active) show(active); });
  }
})();
