(function () {
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // projects.html#agent-memory opens that topic; #chronosgraph opens its topic and the card
  function openFromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    var target = id && document.getElementById(id);
    if (!target || target.tagName !== 'DETAILS') return;
    for (var el = target; el; el = el.parentElement.closest('details')) el.open = true;
    target.scrollIntoView({ block: 'start' });
  }

  // videos only load and play while their card is open; reduced motion gets controls instead
  function syncVideos(details) {
    var videos = details.querySelectorAll(':scope > .p-body video');
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      if (!details.open) { v.pause(); continue; }
      if (reducedMotion.matches) { v.controls = true; continue; }
      var playing = v.play();
      if (playing && playing.catch) playing.catch(function () { /* autoplay blocked: poster stays */ });
    }
  }

  document.querySelectorAll('details.proj').forEach(function (d) {
    d.addEventListener('toggle', function () { syncVideos(d); });
  });
  // a closed topic hides its cards, so pause anything inside it too
  document.querySelectorAll('details.topic').forEach(function (t) {
    t.addEventListener('toggle', function () {
      t.querySelectorAll('details.proj[open]').forEach(function (d) {
        if (t.open) syncVideos(d);
        else d.querySelectorAll('video').forEach(function (v) { v.pause(); });
      });
    });
  });

  window.addEventListener('hashchange', openFromHash);
  openFromHash();
})();
