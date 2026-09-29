/*
  Chapter 3: two scroll-driven explanations, four beats each, drawn with steps.js.

  A. Training without pairs (#training-unpaired)
     Two dot clouds, the source body and the target body, with a thin line from each source dot to
     its target dot. The target cloud is laid out so that turning it by a third of a turn puts its
     dots back on the same places: the spread training sees is unchanged, and so is the training
     loss meter, but every line now ends on a different dot. In the last beat the picture splits
     into two rows, the first map above and the new one below.

  B. Training with pairs matched only by action (#training-paired)
     One source clip and five valid target clips of the same action (thin wavy lines). Random picks
     pull the model's answer (bold line) toward one target after another; it ends on their average,
     and two more source clips get the same answer. A counter steps through the paper's pairs per
     group (2, 4, 8, 16, 32, 50) while a bar shows the variation kept, using the paper's measured
     ratio for each (tab_conditional_mean_ladder: 0.020, 0.014, 0.020, 0.015, 0.017, 0.016).

  How it draws
  - Each stage holds one SVG drawn in screen pixels (its viewBox is the stage's width), so text sizes
    in training.css are real sizes. The SVG is rebuilt when the stage width changes and updated in
    place otherwise. Phone stills and the pinned stage share the same code.
  - draw(beat, progress) is a pure function of its arguments, so scrolling back runs it in reverse,
    and draw(i, 1) is the finished picture used for stills and reduced motion.
*/
(function () {
  'use strict';

  if (!window.Steps) return;

  var NS = 'http://www.w3.org/2000/svg';
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  /* ---------- small helpers ---------- */

  function el(tag, attrs, parent, text) {
    var node = document.createElementNS(NS, tag);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function ease(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function seg(p, a, b) { return ease((p - a) / (b - a)); }  // eased 0..1 while p runs from a to b
  function f1(v) { return Math.round(v * 10) / 10; }
  function show(node, o) {
    o = clamp01(o);
    node.setAttribute('opacity', f1(o * 100) / 100);
    node.style.visibility = o < 0.005 ? 'hidden' : '';
  }
  function mixColor(c0, c1, t) {
    return 'rgb(' + c0.map(function (v, i) { return Math.round(v + (c1[i] - v) * t); }).join(',') + ')';
  }
  function textWidth(node) { try { return node.getComputedTextLength(); } catch (e) { return 0; } }

  // Height of the pinned stage: its natural height, but never taller than the screen under the top bar.
  function stageHeight(stage, natural) {
    if (stage.classList.contains('is-still')) return natural;
    return Math.max(300, Math.min(natural, window.innerHeight - 52 - 56));
  }

  // One scene per steps section: build(svg, w, stage, beat) makes the elements for a width and
  // returns them; update(parts, beat, progress) moves them. A phone still is built for its own beat
  // (beat 0 to 3), so it leaves out room for parts that only appear later; the pinned stage is built
  // with beat -1, for all beats.
  function scene(root, build, update) {
    var handle = null;
    var pending = false;
    function draw(beat, progress, stage) {
      var svg = stage.firstChild;
      if (!svg) return;
      var w = Math.round(stage.clientWidth);
      if (!w) return;
      var still = stage.classList.contains('is-still');
      var vh = still ? 0 : window.innerHeight;
      var only = still ? beat : -1;
      if (!svg._parts || svg._w !== w || svg._vh !== vh || svg._only !== only) {
        var before = stage.offsetHeight;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        svg._w = w;
        svg._vh = vh;
        svg._only = only;
        svg._parts = build(svg, w, stage, only);
        // The pinned stage changed height: let steps.js measure it again. This also runs for the
        // first build, which happens inside Steps.mount, so the handle is looked up a frame later.
        if (!pending && stage.offsetHeight !== before && !still) {
          pending = true;
          requestAnimationFrame(function () { pending = false; if (handle) handle.refresh(); });
        }
      }
      update(svg._parts, beat, progress);
    }
    handle = window.Steps.mount(root, {
      setup: function (stage) {
        el('svg', { class: 'tr-svg', 'aria-hidden': 'true', focusable: 'false' }, stage);
      },
      draw: draw
    });
  }

  // Label, track and fill in one row; returns the parts.
  function meterRow(g, x0, x1, y, label, status, narrow) {
    var row = el('g', {}, g);
    var t = el('text', { x: x0, y: y + 5, class: 'tr-label tr-strong' }, row, label);
    var s = el('text', { x: x1, y: y + 5, class: 'tr-status', 'text-anchor': 'end' }, row, status || '');
    var gap = narrow ? 10 : 14;
    var tx0 = x0 + textWidth(t) + gap;
    var tx1 = x1 - (status ? textWidth(s) + gap : 0);
    el('rect', { x: f1(tx0), y: y - 4, width: f1(Math.max(0, tx1 - tx0)), height: 8, rx: 4, class: 'tr-track' }, row);
    var fill = el('rect', { x: f1(tx0), y: y - 4, width: 0, height: 8, rx: 4, class: 'tr-fill' }, row);
    return { g: row, fill: fill, status: s, x0: tx0, w: Math.max(0, tx1 - tx0) };
  }

  /* ---------- A. Training without pairs ---------- */

  var ROT = 120 * DEG;              // a third of a turn: the three-fold cloud lands on itself
  var CLOUD = [];                   // unit-circle layout of the twelve dots, four rings of three
  [[0.3, 78], [0.62, 1], [0.84, 50], [1.0, 102]].forEach(function (ring) {
    for (var k = 0; k < 3; k++) CLOUD.push({ r: ring[0], a: (ring[1] + k * 120) * DEG });
  });
  var DISC = 1.22;                  // radius of the pale disc behind a cloud, in cloud radii

  function buildUnpaired(svg, w, stage, only) {
    var narrow = w < 520;
    svg.classList.toggle('is-narrow', narrow);
    var pad = narrow ? 16 : 32;
    var labelY = pad + (narrow ? 12 : 16);
    var top = labelY + (narrow ? 14 : 22);
    var meterGap = narrow ? 26 : 36;
    var h;
    if (only < 0 || only === 3) {
      h = stageHeight(stage, Math.round(narrow ? w * 0.9 : Math.min(w * 0.76, 600)));
    } else {
      // A still before the split: just the clouds, and the meter from beat 3 on.
      h = Math.round(top + 2 * DISC * Math.min(w * 0.14, 110) + 12 + (only === 2 ? meterGap + 4 : 0) + pad);
    }
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);

    var meterY = h - pad - 4;
    var bottom = only === 0 || only === 1 ? h - pad : meterY - meterGap;
    var P = {
      narrow: narrow,
      sx: w * 0.22, tx: w * 0.78,
      cy: (top + bottom) / 2,
      R: Math.min((bottom - top) / (2 * DISC) - 4, w * 0.14, 110),
      dotR: narrow ? 4.5 : 6
    };
    // In the last beat the picture splits into two rows: the first map above, the new one below.
    var rowH = (bottom - top) / 2;
    var gapLabel = narrow ? 18 : 26;
    P.k = Math.min(1, (rowH - gapLabel) / (2 * DISC * P.R));
    P.y1 = top + gapLabel + rowH / 2;
    P.y2 = P.y1 + rowH;
    P.y1 -= gapLabel / 2; P.y2 -= gapLabel / 2;

    el('text', { x: f1(P.sx), y: labelY, class: 'tr-label tr-strong', 'text-anchor': 'middle' }, svg, 'Source body');
    el('text', { x: f1(P.tx), y: labelY, class: 'tr-label tr-strong', 'text-anchor': 'middle' }, svg, 'Target body');

    // The first map, as its own row for the last beat: parallel lines, the dots as they started.
    P.row1 = el('g', {}, svg);
    var s1 = P.k, r1 = P.dotR * (0.75 + 0.25 * P.k);
    el('circle', { cx: f1(P.sx), cy: f1(P.y1), r: f1(P.R * DISC * s1), class: 'tr-disc' }, P.row1);
    el('circle', { cx: f1(P.tx), cy: f1(P.y1), r: f1(P.R * DISC * s1), class: 'tr-disc' }, P.row1);
    CLOUD.forEach(function (d) {
      var dx = P.R * d.r * Math.cos(d.a) * s1, dy = P.R * d.r * Math.sin(d.a) * s1;
      el('line', { x1: f1(P.sx + dx), y1: f1(P.y1 + dy), x2: f1(P.tx + dx), y2: f1(P.y1 + dy), class: 'tr-map' }, P.row1);
    });
    CLOUD.forEach(function (d) {
      var dx = P.R * d.r * Math.cos(d.a) * s1, dy = P.R * d.r * Math.sin(d.a) * s1;
      el('circle', { cx: f1(P.sx + dx), cy: f1(P.y1 + dy), r: f1(r1), class: 'tr-dot-src' }, P.row1);
      el('circle', { cx: f1(P.tx + dx), cy: f1(P.y1 + dy), r: f1(r1), class: 'tr-dot-tgt' }, P.row1);
    });
    P.row1Label = el('text', { x: f1(w / 2), y: f1(P.y1 - P.R * DISC * s1 + 4), class: 'tr-label tr-strong', 'text-anchor': 'middle' }, P.row1, 'Map 1');
    P.row2Label = el('text', { x: f1(w / 2), y: f1(P.y2 - P.R * DISC * s1 + 4), class: 'tr-label tr-strong', 'text-anchor': 'middle' }, svg, 'Map 2');

    // The main picture: discs, where the target dots were, the turning arrow, lines, dots.
    P.discS = el('circle', { class: 'tr-disc' }, svg);
    P.discT = el('circle', { class: 'tr-disc' }, svg);
    P.ghosts = el('g', {}, svg);
    P.ghost = CLOUD.map(function () { return el('circle', { r: P.dotR, class: 'tr-ghost' }, P.ghosts); });
    P.arc = el('g', { class: 'tr-turn' }, svg);
    P.arcPath = el('path', {}, P.arc);
    P.arcHead = el('path', {}, P.arc);
    P.lines = el('g', {}, svg);
    P.l = CLOUD.map(function () { return el('line', { class: 'tr-map' }, P.lines); });
    var dots = el('g', {}, svg);
    P.src = CLOUD.map(function () { return el('circle', { class: 'tr-dot-src' }, dots); });
    P.tgt = CLOUD.map(function () { return el('circle', { class: 'tr-dot-tgt' }, dots); });

    // Training loss meter: the fill never moves.
    P.meter = meterRow(svg, pad, w - pad, meterY, 'Training loss', 'unchanged', narrow);
    P.meter.fill.setAttribute('width', f1(P.meter.w * 0.42));
    return P;
  }

  function updateUnpaired(P, beat, p) {
    // Beat 1 draws the lines in; beat 2 turns the target cloud; beat 3 shows the loss meter and
    // rocks the cloud a little while the meter holds; beat 4 splits into the two maps.
    var grow = beat === 0 ? seg(p, 0.05, 0.85) : 1;
    var turn = beat === 0 ? 0 : beat === 1 ? ease(p) : 1;
    var rot = ROT * turn;
    if (beat === 2) rot += 20 * DEG * Math.sin(Math.PI * seg(p, 0.3, 1));
    var turnOn = beat === 1 ? seg(p, 0, 0.15) : beat === 2 ? 1 - seg(p, 0, 0.3) : 0;
    var ghostOn = beat === 1 ? seg(p, 0, 0.2) : beat === 2 ? 1 : beat === 3 ? 1 - seg(p, 0, 0.3) : 0;
    var meterOn = beat < 2 ? 0 : beat === 2 ? seg(p, 0, 0.3) : 1;
    var split = beat === 3 ? seg(p, 0.05, 0.75) : 0;

    // Where the main picture sits: full size in the middle, or the lower row once split.
    var s = 1 + (P.k - 1) * split;
    var cy = P.cy + (P.y2 - P.cy) * split;
    var r = P.dotR * (1 + (0.75 + 0.25 * P.k - 1) * split);
    var R = P.R * s;

    P.discS.setAttribute('cx', f1(P.sx)); P.discS.setAttribute('cy', f1(cy)); P.discS.setAttribute('r', f1(R * DISC));
    P.discT.setAttribute('cx', f1(P.tx)); P.discT.setAttribute('cy', f1(cy)); P.discT.setAttribute('r', f1(R * DISC));

    // The lines take the accent colour as they become the second map.
    var lineColor = mixColor([185, 185, 191], [0, 113, 227], split);
    for (var i = 0; i < CLOUD.length; i++) {
      var d = CLOUD[i];
      var bx = P.sx + R * d.r * Math.cos(d.a), by = cy + R * d.r * Math.sin(d.a);
      var ax = P.tx + R * d.r * Math.cos(d.a + rot), ay = cy + R * d.r * Math.sin(d.a + rot);
      P.src[i].setAttribute('cx', f1(bx)); P.src[i].setAttribute('cy', f1(by)); P.src[i].setAttribute('r', f1(r));
      P.tgt[i].setAttribute('cx', f1(ax)); P.tgt[i].setAttribute('cy', f1(ay)); P.tgt[i].setAttribute('r', f1(r));
      P.ghost[i].setAttribute('cx', f1(P.tx + R * d.r * Math.cos(d.a))); P.ghost[i].setAttribute('cy', f1(by)); P.ghost[i].setAttribute('r', f1(r));
      // Each line grows from its source dot, one after another.
      var t = clamp01(grow * 1.6 - (i / CLOUD.length) * 0.6);
      var L = P.l[i];
      L.style.stroke = lineColor;
      L.setAttribute('x1', f1(bx)); L.setAttribute('y1', f1(by));
      L.setAttribute('x2', f1(bx + (ax - bx) * t)); L.setAttribute('y2', f1(by + (ay - by) * t));
      show(L, t > 0 ? 1 : 0);
    }
    show(P.ghosts, ghostOn);
    show(P.meter.g, meterOn);
    show(P.row1, split);
    show(P.row2Label, split);

    // Turning arrow: an arc over the top of the target disc, away from the incoming lines, that
    // grows with the turn and ends in a small head.
    show(P.arc, turnOn);
    var ar = R * DISC + (P.narrow ? 8 : 12);
    var a0 = -125 * DEG, a1 = a0 + Math.max(0.02, ROT * turn) * 0.8;
    var x0 = P.tx + ar * Math.cos(a0), y0 = cy + ar * Math.sin(a0);
    var x1 = P.tx + ar * Math.cos(a1), y1 = cy + ar * Math.sin(a1);
    P.arcPath.setAttribute('d', 'M' + f1(x0) + ' ' + f1(y0) + ' A' + f1(ar) + ' ' + f1(ar) + ' 0 0 1 ' + f1(x1) + ' ' + f1(y1));
    var hs = P.narrow ? 6 : 8;
    var tx = -Math.sin(a1), ty = Math.cos(a1);      // direction of travel
    var nx = Math.cos(a1), ny = Math.sin(a1);       // outward
    P.arcHead.setAttribute('d', 'M' + f1(x1 - tx * hs + nx * hs * 0.7) + ' ' + f1(y1 - ty * hs + ny * hs * 0.7) +
      ' L' + f1(x1) + ' ' + f1(y1) + ' L' + f1(x1 - tx * hs - nx * hs * 0.7) + ' ' + f1(y1 - ty * hs - ny * hs * 0.7));
  }

  /* ---------- B. Training with pairs matched only by action ---------- */

  // Five valid target clips of one action: the same rhythm, different timing and size.
  var TARGETS = [
    { a: 1.00, ph: 0.0, b: 0.22, q: 0.6 },
    { a: 0.82, ph: 1.3, b: 0.18, q: 2.1 },
    { a: 1.08, ph: 2.5, b: 0.25, q: 4.0 },
    { a: 0.90, ph: 3.8, b: 0.16, q: 1.2 },
    { a: 0.95, ph: 5.1, b: 0.24, q: 3.1 }
  ];
  function targetY(k, u) {
    var c = TARGETS[k];
    return c.a * Math.sin(TAU * 1.25 * u + c.ph) + c.b * Math.sin(TAU * 2.5 * u + c.q);
  }
  // Three different source clips.
  var SOURCES = [
    function (u) { return 0.85 * Math.sin(TAU * 1.5 * u + 0.4) + 0.3 * Math.sin(TAU * 3 * u + 1.0); },
    function (u) { return 0.95 * Math.sin(TAU * 1.0 * u + 2.2) + 0.15 * Math.sin(TAU * 4 * u); },
    function (u) { return 0.7 * Math.sin(TAU * 2.0 * u + 4.0) + 0.3 * Math.sin(TAU * 1.0 * u + 0.7); }
  ];
  var LADDER = [[2, 0.020], [4, 0.014], [8, 0.020], [16, 0.015], [32, 0.017], [50, 0.016]];
  var PICKS_2 = [3, 0, 4, 1];                       // beat 2: one random pick after another
  var PICKS_3 = [2, 4, 0, 3, 1, 2, 4, 0, 3];        // beat 3: picks go on while the answer is pulled
  var SAMPLES = 64;

  // Answer weights over the five targets after each pick of beat 3: a running average that starts
  // at the last pick of beat 2.
  var WEIGHTS = (function () {
    var w = [0, 0, 0, 0, 0];
    w[PICKS_2[PICKS_2.length - 1]] = 1;
    var out = [w.slice()];
    PICKS_3.forEach(function (k, n) {
      var a = 1 / (n + 2);
      w = w.map(function (v, j) { return v + a * ((j === k ? 1 : 0) - v); });
      out.push(w.slice());
    });
    return out;
  })();

  function curvePath(x0, x1, mid, amp, fn) {
    var d = '';
    for (var i = 0; i <= SAMPLES; i++) {
      var u = i / SAMPLES;
      d += (i ? ' L' : 'M') + f1(x0 + (x1 - x0) * u) + ' ' + f1(mid - amp * fn(u));
    }
    return d;
  }

  function buildPaired(svg, w, stage, only) {
    var narrow = w < 520;
    svg.classList.toggle('is-narrow', narrow);
    var pad = narrow ? 16 : 32;
    // The counter and bar take the bottom of the stage; a still before the last beat leaves them out.
    var withStrip = only < 0 || only === 3;
    var stripH = withStrip ? 0 : (narrow ? 70 : 86);
    // The first still has no legend either.
    if (only === 0) stripH += narrow ? 36 : 44;
    var h = stageHeight(stage, Math.round((narrow ? w * 1.08 : Math.min(w * 0.8, 620)) - stripH));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);

    var labelY = pad + (narrow ? 12 : 16);
    var barY = h - pad - 4;
    var countY = barY - (narrow ? 30 : 36);
    var srcX0 = pad, srcX1 = pad + w * (narrow ? 0.24 : 0.22);
    var plotX0 = srcX1 + (narrow ? 30 : 48), plotX1 = w - pad;

    // Legend entries: the random pick, then the model's answer (renamed once it settles). They share
    // a line when both fit, else the second goes under the first.
    var sw = narrow ? 22 : 28, gp = 8, sep = narrow ? 18 : 28, lineH = narrow ? 22 : 26;
    var probe = el('text', { class: 'tr-label tr-strong' }, svg);
    function wide(t) { probe.textContent = t; return textWidth(probe); }
    var pickW = wide('Random pick'), ansW = Math.max(wide("Model's answer"), wide('Average motion'));
    svg.removeChild(probe);
    var oneLine = plotX0 + sw + gp + pickW + sep + sw + gp + ansW <= plotX1;
    var legendY = (withStrip ? countY - (narrow ? 40 : 50) : h - pad - (narrow ? 10 : 14)) - (oneLine || only === 3 ? 0 : lineH);
    var top = labelY + (narrow ? 22 : 30);
    var bottom = only === 0 ? h - pad - 8 : legendY - (narrow ? 26 : 34);

    var plotMid = (top + bottom) / 2;
    var plotAmp = (bottom - top) * 0.32;
    var slotH = (bottom - top) / 3;
    var srcAmp = slotH * 0.3;
    var P = { narrow: narrow, plotX0: plotX0, plotX1: plotX1, plotMid: plotMid, plotAmp: plotAmp };

    el('text', { x: srcX0, y: labelY, class: 'tr-label tr-strong' }, svg, 'Source clip');
    var tl = el('text', { x: f1(plotX0), y: labelY, class: 'tr-label tr-strong' }, svg, 'Valid targets, same action');
    if (textWidth(tl) > plotX1 - plotX0) tl.setAttribute('x', f1(plotX1 - textWidth(tl)));

    // Sources: the first in the middle slot, two more above and below for the last beat.
    P.src = []; P.arrows = [];
    var order = [1, 0, 2];
    order.forEach(function (slot, j) {
      var ys = top + slotH * (slot + 0.5);
      var g = el('g', {}, svg);
      el('path', { d: curvePath(srcX0, srcX1, ys, srcAmp, SOURCES[j]), class: 'tr-src' }, g);
      P.src.push(g);
      var ax0 = srcX1 + (narrow ? 6 : 10), ax1 = plotX0 - (narrow ? 6 : 10);
      var ay1 = plotMid + (ys - plotMid) * 0.25;
      var a = el('g', { class: 'tr-arrow' }, svg);
      el('path', { d: 'M' + f1(ax0) + ' ' + f1(ys) + ' L' + f1(ax1) + ' ' + f1(ay1) }, a);
      var ang = Math.atan2(ay1 - ys, ax1 - ax0), hs = narrow ? 5 : 7;
      el('path', { d: 'M' + f1(ax1 - hs * Math.cos(ang - 0.5)) + ' ' + f1(ay1 - hs * Math.sin(ang - 0.5)) + ' L' + f1(ax1) + ' ' + f1(ay1) +
        ' L' + f1(ax1 - hs * Math.cos(ang + 0.5)) + ' ' + f1(ay1 - hs * Math.sin(ang + 0.5)) }, a);
      P.arrows.push(a);
    });

    P.tgt = [];
    var tg = el('g', {}, svg);
    TARGETS.forEach(function (c, k) {
      P.tgt.push(el('path', { d: curvePath(plotX0, plotX1, plotMid, plotAmp, function (u) { return targetY(k, u); }), class: 'tr-target' }, tg));
    });
    P.pick = el('path', { class: 'tr-pick' }, svg);
    P.answer = el('path', { class: 'tr-answer' }, svg);

    P.legPick = el('g', {}, svg);
    P.legAns = el('g', {}, svg);
    var lx = plotX0;
    el('line', { x1: f1(lx), y1: legendY, x2: f1(lx + sw), y2: legendY, class: 'tr-pick' }, P.legPick);
    el('text', { x: f1(lx + sw + gp), y: legendY + 5, class: 'tr-label tr-strong' }, P.legPick, 'Random pick');
    var lx2 = oneLine ? lx + sw + gp + pickW + sep : lx;
    var ansY = oneLine ? legendY : legendY + lineH;
    el('line', { x1: f1(lx2), y1: ansY, x2: f1(lx2 + sw), y2: ansY, class: 'tr-answer' }, P.legAns);
    P.ansText = el('text', { x: f1(lx2 + sw + gp), y: ansY + 5, class: 'tr-label tr-strong' }, P.legAns, "Model's answer");
    P.avgText = el('text', { x: f1(lx2 + sw + gp), y: ansY + 5, class: 'tr-label tr-strong' }, P.legAns, 'Average motion');
    // Once the random pick is gone, this entry moves into its place.
    P.ansShiftX = lx2 - lx;
    P.ansShiftY = ansY - legendY;

    // Counter and bar for the last beat.
    P.strip = el('g', {}, svg);
    P.count = el('text', { x: pad, y: countY + 5, class: 'tr-count' }, P.strip);
    P.countHead = el('tspan', {}, P.count, 'Pairs per group: ');
    P.countNum = el('tspan', { class: 'tr-count-num' }, P.count, '2');
    P.bar = meterRow(P.strip, pad, w - pad, barY, 'Variation kept: about 2%', '', narrow);
    return P;
  }

  function mixPath(P, weights) {
    return curvePath(P.plotX0, P.plotX1, P.plotMid, P.plotAmp, function (u) {
      var s = 0;
      for (var k = 0; k < weights.length; k++) if (weights[k]) s += weights[k] * targetY(k, u);
      return s;
    });
  }

  function updatePaired(P, beat, p) {
    var i, k;
    // Targets fade in one by one in beat 1.
    for (k = 0; k < P.tgt.length; k++) {
      show(P.tgt[k], beat === 0 ? seg(p, 0.1 + k * 0.12, 0.3 + k * 0.12) : 1);
    }
    var extra = beat === 3 ? seg(p, 0.1, 0.4) : 0;
    show(P.src[0], 1);
    show(P.arrows[0], 1);
    for (i = 1; i < 3; i++) { show(P.src[i], extra); show(P.arrows[i], extra); }

    // Which target is the random pick right now, and how visible it is.
    var pick = -1, pickOn = 0;
    if (beat === 1) {
      pick = PICKS_2[Math.min(PICKS_2.length - 1, Math.floor(p * PICKS_2.length))];
      pickOn = seg(p, 0, 0.12);
    } else if (beat === 2) {
      var n = Math.min(PICKS_3.length - 1, Math.floor(p * PICKS_3.length));
      pick = PICKS_3[n];
      pickOn = 1;
    } else if (beat === 3) {
      pick = PICKS_3[PICKS_3.length - 1];
      pickOn = 1 - seg(p, 0, 0.2);
    }
    if (pick >= 0) P.pick.setAttribute('d', P.tgt[pick].getAttribute('d'));
    show(P.pick, pickOn);
    show(P.legPick, pickOn);

    // The answer: a running average of the picks in beat 3, the exact average in beat 4.
    var weights = null, ansOn = 0;
    if (beat === 2) {
      var x = p * PICKS_3.length;
      var m = Math.min(PICKS_3.length - 1, Math.floor(x));
      var f = ease(x - m);
      // At the end of beat 3 the answer has taken in every pick.
      if (p >= 1) { m = PICKS_3.length - 1; f = 1; }
      weights = WEIGHTS[m].map(function (v, j) { return v + (WEIGHTS[m + 1][j] - v) * f; });
      ansOn = seg(p, 0, 0.1);
    } else if (beat === 3) {
      var s = seg(p, 0, 0.3);
      var last = WEIGHTS[WEIGHTS.length - 1];
      weights = last.map(function (v) { return v + (0.2 - v) * s; });
      ansOn = 1;
    }
    if (weights) P.answer.setAttribute('d', mixPath(P, weights));
    show(P.answer, ansOn);
    show(P.legAns, ansOn);
    var renamed = beat === 3 ? seg(p, 0.15, 0.35) : 0;
    P.legAns.setAttribute('transform', 'translate(' + f1(-P.ansShiftX * renamed) + ' ' + f1(-P.ansShiftY * renamed) + ')');
    show(P.ansText, 1 - renamed);
    show(P.avgText, renamed);

    // Counter and bar: step through the paper's pairs per group, then show the whole range.
    var stripOn = beat === 3 ? seg(p, 0.2, 0.4) : 0;
    show(P.strip, stripOn);
    if (beat === 3) {
      var idx = Math.max(0, Math.min(LADDER.length - 1, Math.floor((p - 0.35) / 0.58 * LADDER.length)));
      var done = p >= 0.97;
      P.countNum.textContent = done ? '2 … 50' : String(LADDER[idx][0]);
      var ratio = LADDER[done ? LADDER.length - 1 : idx][1];
      P.bar.fill.setAttribute('width', f1(Math.max(4, P.bar.w * ratio)));
    }
  }

  /* ---------- mount ---------- */

  var a = document.getElementById('training-unpaired');
  var b = document.getElementById('training-paired');
  if (a) scene(a, buildUnpaired, updateUnpaired);
  if (b) scene(b, buildPaired, updatePaired);
})();
