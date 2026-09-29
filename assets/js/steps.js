/*
  Pinned steps: a picture that stays in place while short texts ("beats") scroll past it.
  Used by the explanations in chapters 3 and 4.

  Markup (the stage starts empty; the chapter script builds what goes inside it):

    <div class="steps" id="gauge-steps" aria-label="...">
      <div class="steps-visual"><div class="steps-sticky"><div class="steps-stage"></div></div></div>
      <div class="steps-beats">
        <div class="step"><p class="step-text">First beat.</p></div>
        <div class="step"><p class="step-text">Second beat.</p></div>
        ...
      </div>
    </div>

  Script, loaded after this file:

    Steps.mount(document.getElementById('gauge-steps'), {
      setup: function (stage) { ... },                  // optional: build the SVG or canvas inside this stage
      draw: function (beat, progress, stage) { ... }    // draw beat number `beat` (0 = first) at `progress`
    });

  What draw receives:
  - beat: which beat is showing, 0 to N-1.
  - progress: 0 to 1 within that beat. It is 0 when the beat's text comes up near the bottom of the
    screen and reaches 1 when the text is in the middle of the screen; it then stays at 1 while the
    reader reads, until the next beat's text comes up. So draw(i, 0) should look like the end of
    beat i-1, and draw(i, 1) is the finished picture for beat i. Scrolling back runs it in reverse.
    Before the section, draw gets (0, 0); after it, (N-1, 1).
  - stage: the element to draw into. On wide screens this is the one pinned stage. draw is only
    called when beat or progress has changed.

  Wide screens (900 px and up): the visual is pinned on the right while the texts scroll on the left;
  the text of the current beat is dark, the others are faded.
  Narrow screens (below 900 px): no pinning. Each beat's text is followed by its own still: a copy of
  the empty stage with the class "is-still", given to setup once and then drawn with draw(i, 1, still).
  Reduced motion (prefers-reduced-motion): the visual is still pinned on wide screens, but it only ever
  shows finished pictures, draw(i, 1), switching when the next beat's text reaches the middle; on
  narrow screens it is the same plain sequence as above.
  Without the script the texts simply follow one another.

  Steps.mount returns { refresh }. Call refresh() if the chapter changes the stage's size by itself;
  window resizes and screen-width changes are handled here (setup runs again for new stills only).
  Keep ids out of the stage: stills are copies of it.
*/
(function () {
  'use strict';

  var WIDE = window.matchMedia('(min-width: 900px)');
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  function listen(query, fn) {
    if (query.addEventListener) query.addEventListener('change', fn);
    else if (query.addListener) query.addListener(fn);
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function mount(root, options) {
    var setup = options.setup || function () {};
    var draw = options.draw;
    var stage = root.querySelector('.steps-sticky > .steps-stage') || root.querySelector('.steps-stage');
    var beats = Array.prototype.slice.call(root.querySelectorAll('.step'));
    var texts = beats.map(function (b) { return b.querySelector('.step-text') || b; });
    var template = stage.cloneNode(false); // an empty copy, made before the chapter fills the stage
    template.removeAttribute('id');
    template.classList.add('is-still');
    var stageReady = false;
    var stills = [];
    var mode = '';
    var last = '';
    var ticking = false;

    function current() {
      // Beat i starts when its text centre is at 90% of the screen height and is finished at 50%.
      var h = window.innerHeight;
      var beat = 0;
      var progress = 0;
      for (var i = 0; i < texts.length; i++) {
        var r = texts[i].getBoundingClientRect();
        var centre = r.top + r.height / 2;
        if (centre <= h * 0.9) {
          beat = i;
          progress = clamp01((h * 0.9 - centre) / (h * 0.4));
        }
      }
      return { beat: beat, progress: progress };
    }

    // The pinned visual sits in the middle of a screen-high box. Pull the section up and the next
    // content up by the empty space above and below the visual, so the visual starts right under the
    // content before it.
    function measure() {
      var sticky = stage.parentNode;
      var lift = Math.max(0, (sticky.clientHeight - stage.offsetHeight) / 2);
      root.style.setProperty('--steps-lift', lift.toFixed(1) + 'px');
    }

    function paint() {
      ticking = false;
      if (mode !== 'pinned' && mode !== 'pinned-reduced') return;
      var at = current();
      if (mode === 'pinned-reduced') {
        // Only finished pictures: the beat whose text has reached the middle, else the one before.
        if (at.progress < 1 && at.beat > 0) at.beat -= 1;
        at.progress = 1;
      }
      beats.forEach(function (b, i) { b.classList.toggle('is-current', i === at.beat); });
      var key = at.beat + ':' + at.progress.toFixed(4);
      if (key === last) return;
      last = key;
      draw(at.beat, at.progress, stage);
    }

    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(paint); }
    }

    function removeStills() {
      stills.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });
      stills = [];
    }

    function apply() {
      var next = WIDE.matches ? (REDUCED.matches ? 'pinned-reduced' : 'pinned') : 'sequence';
      if (next === mode) { last = ''; if (mode === 'sequence') drawStills(); else paint(); return; }
      mode = next;
      last = '';
      if (mode === 'sequence') {
        root.classList.remove('is-pinned');
        beats.forEach(function (b) { b.classList.remove('is-current'); });
        if (!stills.length) {
          beats.forEach(function (b) {
            var wrap = document.createElement('div');
            wrap.className = 'step-still';
            var still = template.cloneNode(false);
            wrap.appendChild(still);
            b.appendChild(wrap);
            stills.push(wrap);
            setup(still);
          });
        }
        drawStills();
      } else {
        removeStills();
        root.classList.add('is-pinned');
        if (!stageReady) { stageReady = true; setup(stage); }
        measure();
        paint();
      }
    }

    function drawStills() {
      stills.forEach(function (wrap, i) { draw(i, 1, wrap.firstChild); });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    // Phones fire resize when the address bar slides; stills are redrawn only when the width changes.
    var width = window.innerWidth;
    window.addEventListener('resize', function () {
      if (mode === 'sequence') {
        if (window.innerWidth !== width) { width = window.innerWidth; drawStills(); }
      } else {
        width = window.innerWidth;
        last = '';
        measure();
        onScroll();
      }
    });
    listen(WIDE, apply);
    listen(REDUCED, apply);
    apply();

    return {
      refresh: function () {
        last = '';
        if (mode === 'sequence') drawStills(); else { measure(); paint(); }
      }
    };
  }

  window.Steps = { mount: mount };
})();
