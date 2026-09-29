/*
  Bars that grow once, the first time they come into view (chapters 4 and 5).

  1. Plain HTML bars. Mark the chart with data-bars; each bar is a .bar-fill inside a .bar-track.
     Position and length are set by the chapter (left and width, as percentages of the track):

       <div class="..." data-bars>
         <div class="bar-track"><div class="bar-fill" style="width: 68.1%"></div></div>
         <span class="bar-after">0.681</span>
         ...
       </div>

     When a third of the chart is on screen, every .bar-fill grows from its left end, one after another
     (set --i: 0, 1, 2 ... on a bar, or on anything around it, to stagger them), and every .bar-after
     (a value or note next to a bar) fades in after its bar. Add the class grows-left to a .bar-fill
     that should grow from its right end instead (a bar below zero). The bars keep their own shape and
     colour; only a clip is animated.

  2. Anything drawn by a script (SVG or canvas):

       Bars.whenSeen(element, function (t) { ... }, { duration: 1100 });

     calls the function on every frame with t going from 0 to 1 (eased: fast start, soft finish),
     once, the first time a third of the element is on screen. The chapter draws its bars at t.

  With prefers-reduced-motion everything is drawn at its final state straight away (t = 1, no fading).
  Without the script the HTML bars are simply drawn full. Charts marked data-bars are found when this
  file loads; for charts added later, call Bars.scan(container).
*/
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function onFirstSight(el, fn) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || e.intersectionRatio < 0.33) return;
        io.disconnect();
        fn();
      });
    }, { threshold: [0, 0.33, 0.66, 1] });
    io.observe(el);
  }

  function whenSeen(el, draw, options) {
    var duration = (options && options.duration) || 1100;
    if (REDUCED.matches) { draw(1); return; }
    draw(0);
    onFirstSight(el, function () {
      if (REDUCED.matches) { draw(1); return; }
      var t0 = 0;
      function frame(now) {
        if (!t0) t0 = now;
        var t = Math.min(1, (now - t0) / duration);
        draw(ease(t));
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  function arm(chart) {
    if (chart.__bars || REDUCED.matches) return;
    chart.__bars = true;
    chart.classList.add('is-armed');
    onFirstSight(chart, function () {
      // Let the browser paint the empty state first, so the transition runs.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { chart.classList.add('is-grown'); });
      });
    });
  }

  function scan(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('[data-bars]'), arm);
  }

  scan(document);

  window.Bars = { whenSeen: whenSeen, scan: scan };
})();
