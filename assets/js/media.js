/* Chapter 6: the Dancer 1 / Dancer 2 switch that phones and tablets use for the two-dancer clips.
   Below 900 px the table shows one dancer's four clips at a time; on wider screens both columns show
   and the switch is hidden by media.css. Without this script both columns show one after the other. */
(function () {
  'use strict';

  Array.prototype.forEach.call(document.querySelectorAll('.rb-table'), function (table) {
    var body = table.parentElement;
    var bar = body && body.querySelector('.rb-switch');
    if (!bar) return;
    var buttons = bar.querySelectorAll('.rb-switch-button');
    function choose(n) {
      table.setAttribute('data-dancer', n);
      Array.prototype.forEach.call(buttons, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-dancer') === n ? 'true' : 'false');
      });
    }
    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener('click', function () { choose(b.getAttribute('data-dancer')); });
    });
    table.classList.add('is-switchable');
    bar.hidden = false;
  });
})();

/* Chapters 2 and 4: the two wide animal videos. On phones held upright their small print cannot be read, so
   a tap on the clip, or on the enlarge button in its corner, opens it large in the lightbox (videos.js).
   The clip keeps playing in the page as before. */
(function () {
  'use strict';

  var NARROW = window.matchMedia('(max-width: 699px)');
  var ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 1.5h4v4M12.5 1.5L8 6M5.5 12.5h-4v-4M1.5 12.5L6 8"/></svg>';

  Array.prototype.forEach.call(document.querySelectorAll('video[data-enlarge]'), function (v) {
    var frame = v.parentElement;
    var labelId = v.getAttribute('aria-labelledby');
    var label = v.getAttribute('aria-label') || (labelId && document.getElementById(labelId).textContent) || '';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-enlarge';
    button.setAttribute('aria-label', 'Enlarge');
    button.innerHTML = ICON;
    frame.appendChild(button);
    frame.classList.add('can-enlarge');
    function open() {
      if (!window.Videos) return;
      Videos.openLightbox({ src: v.getAttribute('data-src'), poster: v.getAttribute('poster'), label: label,
        ratio: 16 / 9, trigger: button });
    }
    button.addEventListener('click', function (e) { e.stopPropagation(); open(); });
    frame.addEventListener('click', function (e) {
      if (NARROW.matches && !e.target.closest('button')) open();
    });
  });
})();
