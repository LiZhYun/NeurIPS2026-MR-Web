/*
  Hero animation: one stage, three rows.
  Left column: a made-up four-legged creature walking in three styles, each with its label above it.
  Two output columns: Model A turns each style into a two-legged walk that keeps it; Model B gives the
  same average walk for all three, in step. A thin arrow from each source splits toward both outputs.
  Two meters sit under the output columns (on phones, in a small table under the stage).

  How it runs
  - The SVG is drawn in screen pixels: its viewBox is the width of its box, rebuilt when that changes,
    so text sizes in site.css are real sizes.
  - Figures are redrawn every frame from a walking clock and never stop.
  - A timeline of LOOP ms fades things in once (figures, labels), then redraws only the arrows and the
    meters on every loop.
  - The timeline starts when at least half the stage (or half the window, if the stage is taller) is on screen, and pauses when the stage is off
    screen or the tab is hidden.
  - With prefers-reduced-motion the final state is drawn once, each figure in a pose chosen to show its style.
*/
(function () {
  'use strict';

  var svg = document.getElementById('hero-svg');
  if (!svg) return;
  var line = document.getElementById('hero-line');

  var NS = 'http://www.w3.org/2000/svg';
  var LOOP = 8500;
  var TAU = Math.PI * 2;

  /* ---------- small helpers ---------- */

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
  function seg(t, start, dur) { return easeInOut((t - start) / dur); }
  function f1(v) { return Math.round(v * 10) / 10; }
  function pt(p) { return f1(p[0]) + ' ' + f1(p[1]); }
  function frac(x) { return x - Math.floor(x); }
  function add(p, q, s) { return [p[0] + q[0] * s, p[1] + q[1] * s]; }
  function dirUp(a) { return [Math.cos(a), -Math.sin(a)]; }          // angle above the +x axis
  function dirDown(a) { return [Math.sin(a), Math.cos(a)]; }         // angle from straight down, + is forward

  // Break text into lines that fit maxW, measured with the font the browser actually uses.
  function wrap(node, text, x, y, maxW, lh) {
    node.textContent = '';
    return wrapInto(node, el('tspan', {}, node), text, x, y, maxW, lh);
  }

  // Like wrap, but adds the lines as tspans of an existing text node, after what it already holds.
  function wrapInto(node, probe, text, x, y, maxW, lh) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      probe.textContent = next;
      if (cur && probe.getComputedTextLength() > maxW) { lines.push(cur); cur = w; } else cur = next;
    });
    lines.push(cur);
    node.removeChild(probe);
    lines.forEach(function (s, i) { el('tspan', { x: x, y: y + i * lh }, node, s); });
    return lines.length;
  }

  // Foot path over one step cycle, relative to the foot's rest point, for walking in place.
  // Stance (p < duty): the foot slides back at an even pace. Swing: it lifts and comes forward on a smooth curve.
  function footPath(p, g, lift) {
    p = frac(p);
    var d = g.duty, s = g.stride;
    if (p < d) return [s * (0.5 - p / d), 0, true];
    var u = (p - d) / (1 - d);
    var e = easeInOut(u);
    var sn = Math.sin(Math.PI * u);
    return [s * (e - 0.5), -(lift || g.lift) * Math.pow(sn, 1.4), false];
  }

  // Two-segment limb: joint position for a root, an end point and segment lengths.
  // bend = +1 puts the joint toward the front (+x) for a limb pointing down, -1 toward the back.
  function solve(root, end, a, b, bend) {
    var dx = end[0] - root[0], dy = end[1] - root[1];
    var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var dmax = a + b - 0.01, dmin = Math.abs(a - b) + 0.01;
    if (d > dmax) { end = [root[0] + dx / d * dmax, root[1] + dy / d * dmax]; d = dmax; }
    if (d < dmin) d = dmin;
    var base = Math.atan2(dy, dx);
    var c = (a * a + d * d - b * b) / (2 * a * d);
    var al = Math.acos(clamp(c, -1, 1));
    var ang = base - bend * al;
    return [[root[0] + a * Math.cos(ang), root[1] + a * Math.sin(ang)], end];
  }

  // Highest a joint at x can sit so that every foot on the ground can still reach it.
  function reach(x, feet, len) {
    var h = Infinity;
    feet.forEach(function (f) {
      if (!f[2]) return;
      var dx = f[0] - x;
      h = Math.min(h, Math.sqrt(Math.max(0, len * len - dx * dx)));
    });
    return h;
  }

  // Smooth bumps over the cycle: [centre, half width, height], wrapping round at 1.
  function bumps(phi, list) {
    var y = 0;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(frac(phi - list[i][0] + 0.5) - 0.5);
      if (d < list[i][1]) y += list[i][2] * 0.5 * (1 + Math.cos(Math.PI * d / list[i][1]));
    }
    return y;
  }

  function limbD(root, r) { return 'M' + pt(root) + ' L' + pt(r[0]) + ' L' + pt(r[1]); }

  /* ---------- the four-legged creature (sources) ---------- */

  // Legs: F = front, H = hind; up and low are the two segment lengths. The front joint (knee) bends
  // forward, the hind joint (hock) backward.
  var CREATURE = {
    // Medium height, head and tail up, diagonal legs together, clear bob.
    trot: {
      period: 680, duty: 0.44, stride: 26, lift: 12,
      len: 70, stretch: 0, hipH: 45, shH: 46, lift2: [[0.22, 0.22, 5], [0.72, 0.22, 5]],
      upF: 27, lowF: 22, upH: 30, lowH: 20, arch: 5, archSwing: 0, rootF: 2, rootH: 0,
      neck: 24, neckAng: 1.0, headTilt: 0.8, nod: 0.08, tail: 28, tailAng: 0.7, tailCurve: -0.5, sway: 0.12,
      legs: { HL: 0, FR: 0.02, HR: 0.5, FL: 0.52 }, still: 0.62, height: 80
    },
    // Belly close to the ground, legs deeply bent (elbows back, knees forward), shoulders high,
    // head low and forward, tail low; slow smooth steps, one foot at a time.
    creep: {
      period: 1500, duty: 0.76, stride: 13, lift: 5,
      len: 72, stretch: 0, hipH: 21, shH: 26, lift2: [[0.12, 0.2, 0.8], [0.62, 0.2, 0.8]],
      upF: 19, lowF: 22, upH: 19, lowH: 22, bendF: -1, bendH: 1, arch: -3, archSwing: 0, rootF: 6, rootH: -4,
      neck: 22, neckAng: -0.05, headTilt: 0.15, nod: 0.03, tail: 38, tailAng: -0.12, tailCurve: 0.25, sway: 0.06,
      legs: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, still: 0.18, height: 42
    },
    // Long stretched body; front legs together and hind legs together, reaching far forward and back;
    // a short airborne moment each cycle; head low, tail streaming back.
    bound: {
      period: 900, duty: 0.3, stride: 66, lift: 8, liftF: 11, liftH: 12,
      len: 92, stretch: 0.14, stretchPh: 0.36, hipH: 41, shH: 40,
      lift2: [[0.37, 0.1, 6], [0.88, 0.16, 10]],
      upF: 24, lowF: 22, upH: 26, lowH: 22, bendF: -1, arch: 2, archSwing: 3, rootF: 6, rootH: -4,
      neck: 26, neckAng: 0.05, headTilt: 0.55, nod: 0.08, tail: 40, tailAng: 0.08, tailCurve: 0.12, sway: 0.08,
      legs: { HL: 0, HR: 0.04, FL: 0.42, FR: 0.46 }, still: 0.36, height: 62
    }
  };
  var C_HEAD = 7.5;

  function Creature(parent, g) {
    this.g = g;
    this.shadow = el('ellipse', { cx: 0, cy: 2, rx: 50, ry: 4.5, fill: 'url(#hx-shadow)' }, parent);
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
    var st = g.stretch ? Math.cos(TAU * (phi - g.stretchPh)) : 0;      // +1 stretched, -1 gathered
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
    var back = [-len * 0.3, arch], bl = Math.hypot(back[0], back[1]);   // the spine's direction out of the hip, reversed
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
    this.shadow.setAttribute('opacity', f1((1 - 0.45 * rise) * 100) / 100);
  };

  /* ---------- the two-legged figure (outputs) ---------- */

  var WALKER = {
    // Bob, high knees, lively arms.
    bouncy: { period: 680, duty: 0.52, stride: 24, lift: 19, hipH: 44, bob: [[0.13, 0.2, 5], [0.63, 0.2, 5]],
      lean: -0.02, head: 0.05, arm: 0.85, armBias: 0.2, elbow: 0.9, still: 0.4 },
    // Bent knees, torso forward, short steps.
    crouch: { period: 1500, duty: 0.66, stride: 13, lift: 4, hipH: 34, bob: [[0.16, 0.2, 0.6], [0.66, 0.2, 0.6]],
      lean: 0.52, head: -0.35, arm: 0.22, armBias: 0.45, elbow: 1.0, still: 0.1 },
    // Long steps, forward lean, big arm swing.
    long: { period: 920, duty: 0.58, stride: 54, lift: 10, hipH: 43, bob: [[0.15, 0.2, 2], [0.65, 0.2, 2]],
      lean: 0.26, head: -0.12, arm: 1.1, armBias: 0.05, elbow: 0.35, still: 0.02 },
    // The same average walk for every source.
    average: { period: 1000, duty: 0.6, stride: 26, lift: 7, hipH: 44, bob: [[0.15, 0.2, 1.5], [0.65, 0.2, 1.5]],
      lean: 0.06, head: 0, arm: 0.5, armBias: 0.05, elbow: 0.3, still: 0.02 }
  };
  var THIGH = 23, SHIN = 23, TORSO = 31, NECK = 7, W_HEAD = 8.5, UPPER = 18, FORE = 16, JOINT = 0;

  function Walker(parent, g) {
    this.g = g;
    this.shadow = el('ellipse', { cx: 0, cy: 2, rx: 24, ry: 4.5, fill: 'url(#hx-shadow)' }, parent);
    var far = el('g', { 'class': 'hx-far' }, parent);
    this.farArm = el('path', { 'class': 'hx-line' }, far);
    this.farLeg = el('path', { 'class': 'hx-line' }, far);
    this.torso = el('path', { 'class': 'hx-line hx-thick' }, parent);
    this.head = el('circle', { 'class': 'hx-fillink', r: W_HEAD }, parent);
    this.hips = el('circle', { 'class': 'hx-fillink', r: JOINT }, parent);
    this.nearLeg = el('path', { 'class': 'hx-line' }, parent);
    this.shoulders = el('circle', { 'class': 'hx-fillink', r: JOINT }, parent);
    this.nearArm = el('path', { 'class': 'hx-line' }, parent);
  }
  Walker.prototype.update = function (phi) {
    var g = this.g, L = THIGH + SHIN;
    var nf = footPath(phi, g), ff = footPath(phi + 0.5, g);
    var shift = g.lean * 8;                       // feet sit a little ahead of the hip when leaning
    nf[0] += shift; ff[0] += shift;
    var hipY = Math.min(g.hipH + bumps(phi, g.bob), reach(0, [nf, ff], L * 0.99));
    var pelvis = [0, -hipY];
    var up = [Math.sin(g.lean), -Math.cos(g.lean)];
    var chest = add(pelvis, up, TORSO);
    var shoulder = add(pelvis, up, TORSO - 4);
    // Torso: a gentle curve from pelvis to the base of the neck, with the back slightly rounded.
    var mid = add(add(pelvis, up, TORSO * 0.5), [-up[1], up[0]], -2.5);
    this.torso.setAttribute('d', 'M' + pt(pelvis) + ' Q' + pt(mid) + ' ' + pt(chest) +
      ' L' + pt(add(chest, dirDown(Math.PI - g.lean - g.head), NECK)));
    var hc = add(chest, dirDown(Math.PI - g.lean - g.head), NECK + W_HEAD + 1.5);
    this.head.setAttribute('cx', f1(hc[0]));
    this.head.setAttribute('cy', f1(hc[1]));

    this.hips.setAttribute('cx', f1(pelvis[0])); this.hips.setAttribute('cy', f1(pelvis[1]));
    this.shoulders.setAttribute('cx', f1(shoulder[0])); this.shoulders.setAttribute('cy', f1(shoulder[1]));
    this.nearLeg.setAttribute('d', limbD(pelvis, solve(pelvis, nf, THIGH, SHIN, 1)));
    this.farLeg.setAttribute('d', limbD(pelvis, solve(pelvis, ff, THIGH, SHIN, 1)));

    // Arms swing opposite to the legs: the near arm is back when the near foot is forward.
    // The cosine below peaks when the near foot is furthest forward, so the swing takes its negative.
    function armD(a) {
      var ua = a + g.armBias + g.lean * 0.5;
      var elbow = add(shoulder, dirDown(ua), UPPER);
      var hand = add(elbow, dirDown(Math.min(ua + g.elbow, 0.95)), FORE);
      return 'M' + pt(shoulder) + ' L' + pt(elbow) + ' L' + pt(hand);
    }
    var swing = -g.arm * Math.cos(TAU * (phi - g.duty / 2 + 0.25));
    this.nearArm.setAttribute('d', armD(swing));
    this.farArm.setAttribute('d', armD(-swing));

    var rise = clamp01((hipY - g.hipH + 1) / 6);
    this.shadow.setAttribute('rx', f1(22 * (1 - 0.25 * rise)));
    this.shadow.setAttribute('opacity', f1((1 - 0.35 * rise) * 100) / 100);
  };

  /* ---------- content ---------- */

  var SOURCES = [
    { style: CREATURE.trot, head: 'Source 1:', name: 'bouncy trot' },
    { style: CREATURE.creep, head: 'Source 2:', name: 'low creep' },
    { style: CREATURE.bound, head: 'Source 3:', name: 'long bounding stride' }
  ];
  var MODELS = [
    { title: 'Model A', sub: 'Keeps each style', outputs: [WALKER.bouncy, WALKER.crouch, WALKER.long],
      follow: 0.86, followStatus: 'Keeps the source', followOn: true },
    { title: 'Model B', sub: 'Same average walk for all three', outputs: [WALKER.average, WALKER.average, WALKER.average],
      follow: 0, followStatus: 'Ignores the source', followOn: false }
  ];
  var ACTION = 0.8;
  var METERS = [
    { name: 'Shows the right action' },
    { name: 'Follows the source', note: 'Source-Instance Fidelity, SIF' }
  ];

  /* ---------- building the stage for a given width ---------- */

  var defs = el('defs', {}, svg);
  var grad = el('radialGradient', { id: 'hx-shadow' }, defs);
  el('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': '0.15' }, grad);
  el('stop', { offset: '0.6', 'stop-color': '#000', 'stop-opacity': '0.07' }, grad);
  el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '0' }, grad);

  var scene = null, figures = [], parts = null, builtFor = '';

  // Rounded corner path through a list of points (radius r at each inner corner).
  function rounded(points, r) {
    var d = 'M' + pt(points[0]);
    for (var i = 1; i < points.length - 1; i++) {
      var p = points[i], a = points[i - 1], b = points[i + 1];
      var la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      var rr = Math.min(r, la / 2, lb / 2);
      var p1 = [p[0] + (a[0] - p[0]) / la * rr, p[1] + (a[1] - p[1]) / la * rr];
      var p2 = [p[0] + (b[0] - p[0]) / lb * rr, p[1] + (b[1] - p[1]) / lb * rr];
      d += ' L' + pt(p1) + ' Q' + pt(p) + ' ' + pt(p2);
    }
    return d + ' L' + pt(points[points.length - 1]);
  }

  function build(W, narrow) {
    if (scene) svg.removeChild(scene);
    scene = el('g', {}, svg);
    svg.classList.toggle('is-narrow', narrow);
    figures = [];
    parts = { sources: [], heads: [], arrows: [], outs: [], meters: [], statuses: [] };

    var k = narrow ? clamp(W / 358, 1, 1.1) : clamp(W / 1080, 0.8, 1);
    var colS = Math.round(W * (narrow ? 0.4 : 0.34));
    var colO = (W - colS) / 2;
    var cols = [colS, colS + colO];
    var cx = [colS + colO / 2, colS + colO * 1.5];

    // Column heads.
    var titleY = narrow ? 18 : 22, subY = narrow ? 38 : 45, subLH = narrow ? 15 : 20, subLines = 1;
    MODELS.forEach(function (m, j) {
      var g = el('g', {}, scene);
      el('text', { 'class': 'hx-title', x: cx[j], y: titleY, 'text-anchor': 'middle' }, g, m.title);
      var sub = el('text', { 'class': 'hx-sub', 'text-anchor': 'middle' }, g);
      subLines = Math.max(subLines, wrap(sub, m.sub, cx[j], subY, colO - (narrow ? 2 : 32), subLH));
      parts.heads.push(g);
    });
    var rowsY = subY + (subLines - 1) * subLH + (narrow ? 10 : 24);

    var R = Math.round((narrow ? 100 : 118) * k);
    var cS = (narrow ? 0.6 : 1.08) * k, wS = (narrow ? 0.62 : 1.08) * k;
    var srcX = Math.round(colS * (narrow ? 0.5 : 0.4));
    var rowsEnd = rowsY + 3 * R, lastLow = 0;

    // Hairline between the two output columns.
    el('line', { 'class': 'hx-rule', x1: cols[1], y1: 4, x2: cols[1], y2: rowsEnd - 6 }, scene);

    SOURCES.forEach(function (src, i) {
      var top = rowsY + i * R, ground = top + R - (narrow ? 8 : 14);
      // Every label sits at the same place in its row, so the rows keep an even rhythm.
      var label = el('text', { 'class': 'hx-label', 'text-anchor': 'middle' }, scene);
      var ly = top + (narrow ? 12 : 15);
      if (narrow) {
        el('tspan', { 'class': 'hx-label-strong', x: srcX, y: ly }, label, src.head);
        var nameT = el('tspan', {}, label);
        wrapInto(label, nameT, src.name, srcX, ly + 15, colS - 8, 15);
      } else {
        el('tspan', { 'class': 'hx-label-strong', x: srcX, y: ly }, label, src.head);
        el('tspan', {}, label, ' ' + src.name);
      }
      // A low creature is raised so its body sits level with the arrow and close to its label.
      var ay = ground - Math.round((narrow ? 26 : 38) * k);
      var sGround = Math.round(Math.min(ground, ay + (src.style.hipH + src.style.shH) / 2 * cS));
      var sg = el('g', { 'class': 'hx-src' }, scene);
      var creature = new Creature(sg, src.style);
      // Centre each creature on its label by its full extent over a whole cycle, and on phones shrink it
      // if needed so it stays inside the source column, clear of the arrow.
      var x1 = Infinity, x2 = -Infinity;
      for (var q = 0; q < 1; q += 0.05) {
        creature.update(q);
        var bb = sg.getBBox();
        x1 = Math.min(x1, bb.x - 2); x2 = Math.max(x2, bb.x + bb.width + 2);
      }
      var sc = narrow ? Math.min(cS, (colS - 22) / (x2 - x1)) : cS;
      sg.setAttribute('transform', 'translate(' + f1(srcX - (x1 + x2) / 2 * sc) + ' ' + sGround + ') scale(' + f1(sc * 100) / 100 + ')');
      figures.push({ fig: creature, g: src.style });
      parts.sources.push({ fig: sg, label: label });

      // Arrow: one thin arrow from each source into its row of outputs. The rows line up, so the two
      // outputs in a row are read as answers to that row's source.
      var x0 = colS - Math.round((narrow ? 8 : 92) * k), xe = colS + Math.round((narrow ? 4 : 16) * k);
      var low = ground + (narrow ? 10 : 12);
      lastLow = low;
      var ag = el('g', { 'class': 'hx-arrows' }, scene);
      var stem = el('path', { 'class': 'hx-arrow', d: 'M' + x0 + ' ' + ay + ' L' + xe + ' ' + ay, pathLength: 1 }, ag);
      var h = narrow ? 4.5 : 6;
      var head = el('path', { 'class': 'hx-arrow', d: 'M' + f1(xe - h) + ' ' + f1(ay - h) + ' L' + xe + ' ' + ay + ' L' + f1(xe - h) + ' ' + f1(ay + h) }, ag);
      parts.arrows.push({ stem: stem, head: head });

      MODELS.forEach(function (m, j) {
        var og = el('g', { 'class': 'hx-out', transform: 'translate(' + f1(cx[j] + (narrow ? 4 : 8) * k) + ' ' + ground + ')' }, scene);
        var inner = el('g', { transform: 'scale(' + f1(wS * 100) / 100 + ')' }, og);
        figures.push({ fig: new Walker(inner, m.outputs[i]), g: m.outputs[i] });
        parts.outs.push({ g: og, i: i, j: j });
      });
    });

    var H;
    if (!narrow) {
      // Meters under the output columns, their names in the source column.
      var my = Math.max(rowsEnd, lastLow + 4) + 8, pad = Math.round(24 * k), step = 41;
      el('line', { 'class': 'hx-rule', x1: cols[0] + pad, y1: my - 4, x2: W - pad, y2: my - 4 }, scene);
      METERS.forEach(function (meter, j) {
        var y = my + 8 + j * step;
        var nx = colS - pad;
        el('text', { 'class': 'hx-meter', x: nx, y: y + 16, 'text-anchor': 'end' }, scene, meter.name);
        if (meter.note) el('text', { 'class': 'hx-note', x: nx, y: y + 33, 'text-anchor': 'end' }, scene, meter.note);
        MODELS.forEach(function (m, c) {
          addMeter(j, m, cols[c] + pad, y + 14, y + 23, colO - 2 * pad, 8);
        });
      });
      el('line', { 'class': 'hx-rule', x1: cols[1], y1: my + 4, x2: cols[1], y2: my + 2 * step + 4 }, scene);
      H = my + 2 * step + 8;
    } else {
      // Phones: a small table under the stage, one column per model.
      var ty = Math.max(rowsEnd, lastLow) + 10, p = 14, half = (W - 2 * p) / 2;
      var card = el('rect', { 'class': 'hx-card', x: 0, y: ty, width: W, rx: 16 }, scene);
      var tx = [p, p + half + 6], cw = half - 6;
      var y = ty + 26;
      MODELS.forEach(function (m, c) { el('text', { 'class': 'hx-table-head', x: tx[c], y: y }, scene, m.title); });
      y += 12;
      METERS.forEach(function (meter, j) {
        el('line', { 'class': 'hx-rule', x1: p, y1: y, x2: W - p, y2: y }, scene);
        y += 22;
        el('text', { 'class': 'hx-meter', x: p, y: y }, scene, meter.name);
        if (meter.note) { y += 17; el('text', { 'class': 'hx-note', x: p, y: y }, scene, meter.note); }
        y += 22;
        var lines = 1;
        MODELS.forEach(function (m, c) { lines = Math.max(lines, addMeter(j, m, tx[c], y, 0, cw, 7, true)); });
        var barY = y + (lines - 1) * 15 + 9;
        parts.meters.slice(-2).forEach(function (me) {
          me.track.setAttribute('y', barY); me.fill.setAttribute('y', barY);
        });
        y = barY + 7 + 16;
      });
      card.setAttribute('height', y - ty);
      H = y;
    }

    return Math.ceil(H);
  }

  // One meter: status above a bar. Returns the number of lines the status took.
  function addMeter(j, m, x, statusY, barY, w, barH, mayWrap) {
    var on = j === 0 || m.followOn;
    var status = el('text', { 'class': 'hx-status' + (on ? '' : ' hx-status-off') }, scene);
    var n = mayWrap ? wrap(status, j === 0 ? 'Right action' : m.followStatus, x, statusY, w, 15)
      : (status.setAttribute('x', x), status.setAttribute('y', statusY), status.textContent = j === 0 ? 'Right action' : m.followStatus, 1);
    var track = el('rect', { 'class': 'hx-track', x: x, y: barY, width: w, height: barH, rx: barH / 2 }, scene);
    var fill = el('rect', { 'class': 'hx-fill', x: x, y: barY, width: 0, height: barH, rx: barH / 2 }, scene);
    parts.meters.push({ status: status, track: track, fill: fill, w: w, value: j === 0 ? ACTION : m.follow, j: j });
    return n;
  }

  /* ---------- timeline ---------- */

  function setOpacity(node, v) { node.setAttribute('opacity', v >= 0.999 ? 1 : f1(v * 100) / 100); }
  // Draw a path up to fraction v; hidden at 0, where a round cap would still show a dot.
  function draw(path, v, fade) {
    path.setAttribute('stroke-dasharray', f1(v * 1000) / 1000 + ' 1');
    setOpacity(path, v > 0.001 ? fade : 0);
  }

  // clock: walking time; total: time since the timeline started; t: position in the loop.
  // still: draw each figure in its chosen pose instead of from the clock.
  function render(clock, total, t, still) {
    figures.forEach(function (f) { f.fig.update(still ? f.g.still : frac(clock / f.g.period)); });

    var fade = 1 - 0.6 * seg(t, 7750, 700);                 // arrows ease to a faint resting level before the loop restarts
    parts.sources.forEach(function (s, i) {                 // sources and heads fade in once, walking
      var v = seg(total, i * 150, 700);
      setOpacity(s.fig, v);
      setOpacity(s.label, v);
    });
    parts.heads.forEach(function (h) { setOpacity(h, seg(total, 350, 700)); });
    parts.arrows.forEach(function (a, i) {                  // arrows draw on every loop
      var d = i * 140;
      draw(a.stem, seg(t, 250 + d, 600), fade);
      setOpacity(a.head, seg(t, 780 + d, 220) * fade);
    });
    parts.outs.forEach(function (o) {                       // outputs appear once, after their arrow
      setOpacity(o.g, seg(total, 1100 + o.i * 140 + o.j * 300, 700));
    });
    var first = total < LOOP, REST = 0.35;
    parts.meters.forEach(function (me) {                    // meters fill once, then ease down to a resting level and refill each loop
      var lo = first ? 0 : REST;
      var v = lo + (1 - lo) * seg(t, first ? 1400 + me.j * 400 : 250 + me.j * 250, first ? 1300 : 1100);
      v -= (v - REST) * seg(t, 7750, 700);
      me.fill.setAttribute('width', f1(me.w * me.value * v));
      setOpacity(me.status, seg(total, 2300 + me.j * 400, 600));
      setOpacity(me.track, seg(total, 1500, 600));
    });
    if (line) {                                             // the sentence, once; it then stays
      var l = seg(total, 3400, 800);
      line.style.opacity = f1(l * 100) / 100;
      line.style.transform = 'translateY(' + f1((1 - l) * 8) + 'px)';
    }
  }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var narrowQuery = window.matchMedia('(max-width: 899px)');
  var clock = 0, last = null, raf = 0, onScreen = false, started = false;
  var FINAL = 7000;

  function paint() {
    if (reduced.matches) render(0, FINAL, FINAL, true);
    else render(clock, clock, clock % LOOP, false);
  }
  function frame(now) {
    if (last === null) last = now;
    clock += Math.min(now - last, 50);
    last = now;
    paint();
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = null; }
  function update() {
    if (reduced.matches) { stop(); paint(); return; }
    if (started && onScreen && !document.hidden) { if (!raf) raf = requestAnimationFrame(frame); }
    else stop();
  }
  // Wide: drawn at screen size. Narrow: laid out as on a phone, then scaled up as a whole on wider
  // screens (text, figures and strokes together), so tablets get the phone proportions, larger.
  function relayout() {
    var W = Math.round(svg.parentNode.clientWidth);
    var narrow = narrowQuery.matches;
    var key = W + (narrow ? 'n' : 'w');
    if (!W || key === builtFor) return;
    builtFor = key;
    var s = narrow ? clamp(W / 358, 1, 1.45) : 1, Wl = Math.round(W / s);
    var H = build(Wl, narrow);
    svg.setAttribute('viewBox', '0 0 ' + Wl + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', Math.round(H * s));
    svg.style.setProperty('--k', f1(s * 100) / 100);
    paint();
  }
  function listen(q, fn) {
    if (q.addEventListener) q.addEventListener('change', fn);
    else if (q.addListener) q.addListener(fn);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      onScreen = e.isIntersecting;
      // Half visible, measured against the smaller of the stage and the window, so a stage taller than
      // the window (a phone held sideways) still starts.
      var view = e.rootBounds ? e.rootBounds.height : window.innerHeight;
      if (e.isIntersecting && e.intersectionRect.height >= 0.5 * Math.min(e.boundingClientRect.height, view)) started = true;
      update();
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }).observe(svg);
  } else {
    onScreen = started = true;
  }
  document.addEventListener('visibilitychange', update);
  listen(reduced, update);
  listen(narrowQuery, relayout);
  var pending = false;
  window.addEventListener('resize', function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; relayout(); });
  });

  relayout();
  update();
})();
