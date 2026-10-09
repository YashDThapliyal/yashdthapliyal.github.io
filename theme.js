(function () {
  var root = document.documentElement;
  var KEY = 'theme';
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage unavailable: toggle still works for this visit */ } }
  function current() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var saved = read();
  if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      write(next);
    });
  });
})();
