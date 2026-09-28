/* Page behaviour: top bar after the hero, scroll-progress line, citation copy button. */
(function () {
  'use strict';

  var bar = document.getElementById('topbar');
  var progress = document.getElementById('topbar-progress');
  var hero = document.getElementById('hero');

  // Thin line on the bar's bottom edge showing how far down the page the reader is.
  // The bar itself appears once the hero has scrolled up under it.
  var ticking = false;
  function paint() {
    ticking = false;
    if (bar && hero) bar.classList.toggle('is-visible', hero.getBoundingClientRect().bottom <= 52);
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    progress.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  }
  if (progress && bar) {
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(paint); }
    }, { passive: true });
    window.addEventListener('resize', paint);
    paint();
  }

  // Copy button on the citation block.
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (button) {
    var source = document.getElementById(button.getAttribute('data-copy'));
    var timer = 0;
    button.addEventListener('click', function () {
      var text = source ? source.textContent : '';
      function done() {
        button.classList.add('is-done');
        clearTimeout(timer);
        timer = setTimeout(function () { button.classList.remove('is-done'); }, 1600);
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { if (document.execCommand('copy')) done(); } catch (err) { /* nothing to do */ }
        document.body.removeChild(area);
      }
    });
  });
})();
