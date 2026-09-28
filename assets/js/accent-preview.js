/*
  PREVIEW ONLY: floating accent colour switcher for choosing the page's accent colour.
  Remove this file, its script tag in index.html and the marked block at the end of site.css
  before going live, then set --accent in site.css and the colour in favicon.svg to the chosen value.
  Also reads ?accent=blue|green|orange from the address.
*/
(function () {
  'use strict';

  var ACCENTS = { blue: '#0071e3', green: '#1f9d74', orange: '#e8743b' };
  var root = document.documentElement;
  var icon = document.querySelector('link[rel="icon"]');
  var buttons = {};

  function faviconFor(color) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="' + color +
      '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M32 21v18"/>' +
      '<path d="M32 26l-9 7 3 8M32 26l9 6 5 7"/><path d="M32 39l-7 9-4 10M32 39l7 9 2 10"/></g>' +
      '<circle cx="32" cy="11" r="7" fill="' + color + '"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(s);
  }

  function apply(name, remember) {
    if (!ACCENTS[name]) name = 'blue';
    root.setAttribute('data-accent', name);
    for (var k in buttons) buttons[k].setAttribute('aria-pressed', k === name ? 'true' : 'false');
    if (icon) icon.setAttribute('href', faviconFor(ACCENTS[name]));
    if (remember) {
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('accent', name);
        window.history.replaceState(null, '', url.toString());
      } catch (err) { /* address cannot be changed here, the colour still applies */ }
    }
  }

  var box = document.createElement('div');
  box.className = 'accent-preview';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Accent');
  var label = document.createElement('span');
  label.textContent = 'Accent';
  box.appendChild(label);
  Object.keys(ACCENTS).forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.style.background = ACCENTS[name];
    b.setAttribute('aria-label', name);
    b.addEventListener('click', function () { apply(name, true); });
    buttons[name] = b;
    box.appendChild(b);
  });
  document.body.appendChild(box);

  var asked = null;
  try { asked = new URLSearchParams(window.location.search).get('accent'); } catch (err) { asked = null; }
  apply(asked || 'blue', false);
})();
