/*
  Videos on the page: load late, play muted in view, pause out of view, keep groups in step,
  and a lightbox for the gallery.

  Clips in the page:

    <div class="media-frame" style="--ratio: 16 / 9">
      <video data-src="assets/videos/animals/main_panorama.mp4" poster="assets/videos/animals/main_panorama.jpg"
             aria-label="..." muted loop playsinline preload="none"></video>
    </div>

  - Every <video data-src="..."> on the page is handled when this file loads. For clips added later,
    call Videos.scan(container).
  - The file is only fetched once the clip comes within about one screen of the viewport (the src is set
    then). Until then the poster shows. Without a poster attribute the poster is the same path with .jpg.
  - A clip plays (muted, looping, inline) once at least half of it is on screen, or once it covers half
    the screen for clips taller than that. It pauses when it has left the screen or the tab is hidden.
  - With prefers-reduced-motion nothing starts or loads by itself: the clip shows its poster and a play
    button, and the file is fetched when the reader presses play.
  - Each clip gets a round play/pause button in its bottom-right corner, placed in the clip's parent
    (the .media-frame). Put data-no-toggle on a clip to leave its button out, for example on all but
    one clip of a group. The button of a grouped clip plays or pauses the whole group. A clip the reader
    paused stays paused until the reader plays it again.
  - Groups kept in step: clips with the same data-sync="name" load together, start together from the
    same time once all of them can play, play and pause together (the group plays when any one of them
    is half on screen), and are kept within about 0.1 s of the first shown clip of the group in page order
    (small drifts are evened out by a slight change of speed, large ones by a jump). Clips of a group
    hidden with display: none are paused and come back in step when shown.
    The clips of a group should have the same length.
  - Clips have no browser controls, no download item and no picture-in-picture.

  Lightbox (the gallery in chapter 7): a button with data-lightbox opens a large playing copy of the clip.

    <button class="..." type="button" data-lightbox="assets/videos/animals/app_triple_1_spiderg_tricera_attack.mp4"
            data-label="Spider → Triceratops, attack">
      <img src="assets/videos/animals/app_triple_1_spiderg_tricera_attack.jpg" alt="...">
    </button>

  Nothing is fetched until the button is pressed. The lightbox shows the clip with its label under it,
  and a play/pause button and a close button in the top-right corner of the screen; a click on the clip also plays or pauses it. Escape, the close
  button or a click beside the clip closes it;
  keyboard focus stays inside while it is open and goes back to the button afterwards. Page clips pause
  while it is open. Optional on the button: data-poster (else the clip path with .jpg) and data-ratio
  (width / height, else taken from the image inside the button). On a narrow upright screen a wide clip
  is turned sideways, so it fills the screen's height and reads large with the phone turned. From a script:
  Videos.openLightbox({ src, label, poster, ratio, trigger }) and Videos.closeLightbox().
*/
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  var ICONS = '<svg class="icon-pause" viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="1.5" width="3" height="11" rx="1"/><rect x="8.5" y="1.5" width="3" height="11" rx="1"/></svg>' +
    '<svg class="icon-play" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4c0 .6.7 1 1.2.7l8.3-5.2c.5-.3.5-1 0-1.3L4.2 1.1C3.7.8 3 1.2 3 1.8z"/></svg>';

  var groups = {};
  var groupCount = 0;
  var lightboxOpen = false;

  function prepare(v) {
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('loop', '');
    v.setAttribute('disablepictureinpicture', '');
    v.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
    v.removeAttribute('controls');
    v.removeAttribute('autoplay');
    if (!v.getAttribute('preload')) v.preload = 'none';
    if (!v.getAttribute('poster')) v.poster = v.getAttribute('data-src').replace(/\.mp4$/i, '.jpg');
  }

  function makeToggle(onPress) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'video-toggle';
    b.innerHTML = ICONS;
    b.setAttribute('aria-label', 'Pause');
    b.addEventListener('click', function (e) { e.stopPropagation(); onPress(); });
    return b;
  }

  function setToggle(b, paused) {
    b.classList.toggle('is-paused', paused);
    b.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  function playSafe(v) {
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* the browser refused; the poster stays */ });
  }

  /* Groups. A clip without data-sync is a group of one. */

  function group(name) {
    if (!groups[name]) {
      groups[name] = { videos: [], toggles: [], seen: {}, onScreen: {}, loaded: false,
        playing: false, starting: false, userPaused: REDUCED.matches };
    }
    return groups[name];
  }

  function load(g) {
    if (g.loaded) return;
    g.loaded = true;
    g.videos.forEach(function (v) {
      v.preload = 'auto';
      v.src = v.getAttribute('data-src');
    });
  }

  function wanted(g) {
    if (g.userPaused || lightboxOpen || document.hidden) return false;
    var any = false;
    for (var k in g.seen) if (g.seen[k]) any = true;
    if (g.playing) { any = false; for (var j in g.onScreen) if (g.onScreen[j]) any = true; }
    return any;
  }

  function update(g) {
    var want = wanted(g);
    g.toggles.forEach(function (b) { setToggle(b, g.userPaused); });
    if (want && !g.playing && !g.starting) start(g);
    else if (!want && (g.playing || g.starting)) stop(g);
  }

  function start(g) {
    load(g);
    g.starting = true;
    var ready = g.videos.every(function (v) { return v.readyState >= 3; });
    if (!ready) {
      var check = function () {
        if (!g.starting) return;
        if (g.videos.every(function (v) { return v.readyState >= 3; })) begin(g);
      };
      g.videos.forEach(function (v) {
        v.addEventListener('canplay', check, { once: true });
        v.addEventListener('canplaythrough', check, { once: true });
      });
      return;
    }
    begin(g);
  }

  function begin(g) {
    if (!g.starting) return;
    g.starting = false;
    g.playing = true;
    var t = g.videos[0].currentTime;
    g.videos.forEach(function (v, i) { if (i > 0 && Math.abs(v.currentTime - t) > 0.05) v.currentTime = t; });
    g.videos.forEach(function (v) { if (shown(v) || g.videos.length < 2) playSafe(v); });
    syncLoop();
  }

  function stop(g) {
    g.starting = false;
    g.playing = false;
    g.videos.forEach(function (v) { v.pause(); });
  }

  // A clip hidden with display: none (the Dancer 1 / Dancer 2 switch on phones) is not rendered.
  function shown(v) { return v.getClientRects().length > 0; }

  // Followers are nudged back to the first shown clip of their group when they drift more than 0.1 s.
  // Hidden clips of a group are paused, and jump back into step when they are shown again.
  var syncTimer = 0;
  function syncLoop() {
    if (syncTimer) return;
    syncTimer = setInterval(function () {
      var active = false;
      for (var name in groups) {
        var g = groups[name];
        if (!g.playing || g.videos.length < 2) continue;
        active = true;
        var lead = null;
        for (var j = 0; j < g.videos.length && !lead; j++) if (shown(g.videos[j])) lead = g.videos[j];
        if (!lead) continue;
        // A newly shown clip takes over as the lead: start it where the old lead was.
        if (g.lead && g.lead !== lead && lead.paused && lead.duration) lead.currentTime = g.lead.currentTime % lead.duration;
        g.lead = lead;
        if (lead.paused && !lead.seeking) playSafe(lead);
        if (lead.paused || lead.seeking) continue;
        for (var i = 0; i < g.videos.length; i++) {
          var v = g.videos[i];
          if (v === lead) continue;
          if (!shown(v)) { if (!v.paused) v.pause(); continue; }
          var d = v.duration;
          if (!d || v.seeking) continue;
          var target = lead.currentTime % d;
          var diff = v.currentTime - target;
          if (diff > d / 2) diff -= d;
          if (diff < -d / 2) diff += d;
          // Far off (a stall, or a loop point): jump. Slightly off: run a little faster or slower,
          // which does not stutter the way a jump does.
          if (Math.abs(diff) > 0.5) { v.currentTime = target; v.playbackRate = 1; }
          else if (Math.abs(diff) > 0.03) v.playbackRate = 1 - Math.max(-0.25, Math.min(0.25, diff * 1.5));
          else v.playbackRate = 1;
          if (v.paused) playSafe(v);
        }
      }
      if (!active) { clearInterval(syncTimer); syncTimer = 0; }
    }, 200);
  }

  /* Watching the viewport. */

  var nearObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting || REDUCED.matches) return;
      load(groups[e.target.__videoGroup]);
      nearObserver.unobserve(e.target);
    });
  }, { rootMargin: '100% 0px 100% 0px' });

  var steps = [];
  for (var s = 0; s <= 20; s++) steps.push(s / 20);
  var seenObserver = new IntersectionObserver(function (entries) {
    var touched = {};
    entries.forEach(function (e) {
      var name = e.target.__videoGroup;
      var g = groups[name];
      var key = e.target.__videoIndex;
      var halfScreen = e.intersectionRect.height >= window.innerHeight * 0.5;
      g.seen[key] = e.isIntersecting && (e.intersectionRatio >= 0.5 || halfScreen);
      g.onScreen[key] = e.isIntersecting && e.intersectionRatio > 0;
      touched[name] = true;
    });
    for (var n in touched) update(groups[n]);
  }, { threshold: steps });

  function add(v) {
    if (v.__videoGroup) return;
    prepare(v);
    var name = v.getAttribute('data-sync') || ('solo-' + (++groupCount));
    var g = group(name);
    v.__videoGroup = name;
    v.__videoIndex = g.videos.length;
    g.videos.push(v);
    if (!v.hasAttribute('data-no-toggle') && v.parentElement) {
      var parent = v.parentElement;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      parent.classList.add('has-video-toggle');
      var b = makeToggle(function () {
        g.userPaused = !g.userPaused;
        // Pressing play counts as "seen", so the clip starts even when less than half of it is shown.
        if (!g.userPaused) g.seen[v.__videoIndex] = true;
        update(g);
      });
      parent.appendChild(b);
      g.toggles.push(b);
      setToggle(b, g.userPaused);
    }
    nearObserver.observe(v);
    seenObserver.observe(v);
  }

  function scan(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('video[data-src]'), add);
  }

  function all() { for (var n in groups) update(groups[n]); }

  document.addEventListener('visibilitychange', all);

  /* Lightbox. */

  var box = null;
  var boxVideo = null;
  var boxLabel = null;
  var boxToggle = null;
  var boxClose = null;
  var returnFocus = null;
  var closeTimer = 0;

  function buildBox() {
    box = document.createElement('div');
    box.className = 'lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    boxClose = document.createElement('button');
    boxClose.type = 'button';
    boxClose.className = 'lightbox-close';
    boxClose.setAttribute('aria-label', 'Close');
    boxClose.innerHTML = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>';
    var frame = document.createElement('div');
    frame.className = 'lightbox-frame';
    boxVideo = document.createElement('video');
    boxVideo.muted = true;
    boxVideo.loop = true;
    boxVideo.playsInline = true;
    boxVideo.setAttribute('muted', '');
    boxVideo.setAttribute('playsinline', '');
    boxVideo.setAttribute('disablepictureinpicture', '');
    boxVideo.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
    boxToggle = makeToggle(function () {
      if (boxVideo.paused) playSafe(boxVideo); else boxVideo.pause();
    });
    boxVideo.addEventListener('loadedmetadata', function () {
      if (boxVideo.videoWidth) setRatio(boxVideo.videoWidth / boxVideo.videoHeight);
    });
    window.addEventListener('resize', function () { if (!box.hidden) setRatio(boxRatio); });
    boxVideo.addEventListener('play', function () { setToggle(boxToggle, false); });
    boxVideo.addEventListener('pause', function () { setToggle(boxToggle, true); });
    frame.appendChild(boxVideo);
    boxLabel = document.createElement('p');
    boxLabel.className = 'lightbox-label';
    // The play/pause button sits beside the close button, off the clip.
    box.appendChild(boxToggle);
    box.appendChild(boxClose);
    box.appendChild(frame);
    box.appendChild(boxLabel);
    document.body.appendChild(box);

    boxClose.addEventListener('click', closeLightbox);
    box.addEventListener('click', function (e) { if (e.target === box) closeLightbox(); });
    // A click on the clip plays or pauses it. Keys are watched on the whole document, because a click
    // inside the lightbox can move focus out of it.
    boxVideo.addEventListener('click', function () {
      if (boxVideo.paused) playSafe(boxVideo); else boxVideo.pause();
    });
    document.addEventListener('keydown', function (e) {
      if (box.hidden || !lightboxOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
      if (e.key !== 'Tab') return;
      var stops = [boxToggle, boxClose];
      var i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
    });
  }

  var boxRatio = 16 / 9;
  function setRatio(r) {
    boxRatio = r;
    box.style.setProperty('--r', r);
    var w = window.innerWidth, h = window.innerHeight;
    box.classList.toggle('is-turned', r > 1.2 && h > w && w < 700);
  }

  function openLightbox(o) {
    if (!box) buildBox();
    clearTimeout(closeTimer);
    returnFocus = o.trigger || document.activeElement;
    lightboxOpen = true;
    all();
    boxLabel.textContent = o.label || '';
    boxLabel.hidden = !o.label;
    box.setAttribute('aria-label', o.label || 'Video');
    boxVideo.poster = o.poster || o.src.replace(/\.mp4$/i, '.jpg');
    // Size the frame from the clip's shape before the clip loads: data-ratio, else the still inside
    // the button, else 16:9; corrected once the clip's own size is known.
    var img = o.trigger && o.trigger.querySelector ? o.trigger.querySelector('img') : null;
    var ratio = o.ratio || (img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 16 / 9);
    setRatio(ratio);
    if (o.label) boxVideo.setAttribute('aria-label', o.label);
    boxVideo.src = o.src;
    box.hidden = false;
    document.documentElement.classList.add('is-lightbox-open');
    // Next frame, so the fade-in runs.
    requestAnimationFrame(function () { box.classList.add('is-open'); });
    setToggle(boxToggle, false);
    playSafe(boxVideo);
    boxClose.focus();
  }

  function closeLightbox() {
    if (!box || box.hidden) return;
    box.classList.remove('is-open');
    boxVideo.pause();
    document.documentElement.classList.remove('is-lightbox-open');
    var finish = function () {
      box.hidden = true;
      boxVideo.removeAttribute('src');
      boxVideo.load();
    };
    if (REDUCED.matches) finish(); else closeTimer = setTimeout(finish, 300);
    lightboxOpen = false;
    all();
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-lightbox]') : null;
    if (!t) return;
    e.preventDefault();
    var r = t.getAttribute('data-ratio');
    openLightbox({ src: t.getAttribute('data-lightbox'), label: t.getAttribute('data-label'),
      poster: t.getAttribute('data-poster'), ratio: r ? parseFloat(r) : 0, trigger: t });
  });

  scan(document);

  window.Videos = { scan: scan, openLightbox: openLightbox, closeLightbox: closeLightbox };
})();
