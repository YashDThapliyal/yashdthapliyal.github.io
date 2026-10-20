// ASCII koi pond around the home photo. Koi only pass behind the photo; clicking the water
// drops food they swim to.
(function () {
  var root = document.documentElement;

  var stage = document.getElementById('stage');
  if (!stage) return;
  var photo = document.getElementById('photo');
  var back = document.getElementById('back'), front = document.getElementById('front');
  var bctx = back.getContext('2d'), fctx = front.getContext('2d');
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var FONT_PX = 9, CELL_H = 10, BACK = 0, FRONT = 1, N = 26;
  // colour roles: 1 text, 2 wake, 3 eye, 4 water dots, 5 orange, 6 red, 7 surface (food, ripples)
  var SKIN = 'tS%X8#@';
  var PATCH = '%X8#@';
  var TAIL = ":;!|";
  // kohaku: white with red; tancho: white with a red crown; ogon: solid orange; sanke: white, red, black spots
  var VARIETIES = ['kohaku', 'ogon', 'tancho', 'sanke'];
  var W, H, cols, rows, cw, wake, dots, colors, box;
  var chars = [], role, alpha, layer;
  var koi = [], food = [], ripples = [], pointer = null, lastRipple = null;

  function readColors() {
    var cs = getComputedStyle(root), g = function (k) { return cs.getPropertyValue(k).trim(); };
    colors = { bg: g('--bg'), text: g('--text'), dim: g('--dim'), mid: g('--mid'), link: g('--link'),
      orange: g('--koi-orange'), red: g('--koi-red') };
    colors.light = root.getAttribute('data-theme') === 'light';
  }

  function hash(x, y) { var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function noise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function contour(nx, ny) {
    var a = Math.atan2(nx, -ny) * 180 / Math.PI; a = ((a % 180) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? '-' : a < 67.5 ? '\\' : a < 112.5 ? '|' : '/';
  }

  // top-down koi: round head, full body, slim tail stalk, then a wide flowing tail fan
  function halfWidth(s) {
    if (s < 0.12) return 0.1 * Math.pow(Math.sin((s / 0.12) * Math.PI / 2), 0.6);
    if (s < 0.35) return 0.1 + 0.022 * smooth(0.12, 0.35, s);
    if (s < 0.76) return 0.024 + 0.098 * Math.pow(1 - (s - 0.35) / 0.41, 1.15);
    var k = (s - 0.76) / 0.24;
    return 0.024 + 0.12 * Math.pow(Math.sin(k * Math.PI * 0.88), 0.8);
  }

  function resize() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    W = rect.width; H = rect.height;
    [[back, bctx], [front, fctx]].forEach(function (p) {
      p[0].width = Math.round(W * dpr); p[0].height = Math.round(H * dpr);
      p[1].setTransform(dpr, 0, 0, dpr, 0, 0);
      p[1].font = FONT_PX + 'px ' + getComputedStyle(root).getPropertyValue('--mono');
      p[1].textBaseline = 'top';
    });
    cw = bctx.measureText('M').width || 5.4;
    cols = Math.ceil(W / cw); rows = Math.ceil(H / CELL_H);
    wake = new Float32Array(cols * rows);
    dots = new Uint8Array(cols * rows);
    for (var i = 0; i < dots.length; i++) dots[i] = hash(i % cols, (i / cols) | 0) < 0.05 ? 1 : 0;
    var pr = photo.getBoundingClientRect();
    box = { x0: pr.left - rect.left, y0: pr.top - rect.top, x1: pr.right - rect.left, y1: pr.bottom - rect.top };
  }
  function inPhoto(x, y) { return x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1; }

  function makeKoi() {
    var n = W < 520 ? 2 : W < 900 ? 3 : 4;
    koi = [];
    for (var i = 0; i < n; i++) {
      // one koi per quarter of the pond, pointed anywhere
      var f = { x: W * ((i % 2) * 0.5 + 0.1 + Math.random() * 0.3), y: H * ((i >> 1) * 0.5 + 0.1 + Math.random() * 0.3),
        heading: Math.random() * 6.28,
        speed: 30 + Math.random() * 14, t: Math.random() * 10, trail: [],
        L: Math.min(230, Math.max(120, W * (0.19 + Math.random() * 0.04))),
        kind: VARIETIES[i % VARIETIES.length], seed: Math.random() * 100,
        layer: BACK, tx: 0, ty: 0 };
      pickTarget(f);
      koi.push(f);
    }
  }

  // how well a warmed-up pond shows off its koi: the worst koi's share of body in open water
  // (on screen, not behind the photo), zeroed if any two heads are crowded together
  function openWaterScore() {
    var worst = 1;
    for (var i = 0; i < koi.length; i++) {
      var nodes = spine(koi[i]), seen = 0;
      for (var j = 0; j < nodes.length; j++) {
        var x = nodes[j][0], y = nodes[j][1];
        var m = 30;   // body width plus a little room, so no fin tucks behind the photo
        if (x > m && x < W - m && y > m && y < H - m && !(x > box.x0 - m && x < box.x1 + m && y > box.y0 - m && y < box.y1 + m)) seen++;
      }
      worst = Math.min(worst, seen / nodes.length);
      for (var k = 0; k < i; k++) if (Math.hypot(koi[i].x - koi[k].x, koi[i].y - koi[k].y) < W * 0.15) return 0;
    }
    return worst;
  }

  // let the pond run for a few unseen seconds so the koi are mid-swim on the first frame, keeping
  // the first run (out of a handful) where every koi is fully in open water and spread apart
  function settleKoi() {
    var best = null, bestScore = -1;
    for (var attempt = 0; attempt < 80 && bestScore < 1; attempt++) {
      makeKoi();
      var steps = 240 + Math.floor(Math.random() * 360);
      for (var i = 0; i < steps; i++) koi.forEach(function (f) { stepKoi(f, 1 / 60); });
      var score = openWaterScore();
      if (score > bestScore) { bestScore = score; best = koi; }
    }
    koi = best;
  }

  // aim for open water; koi still pass behind the photo on the way between targets
  function pickTarget(f) {
    for (var i = 0; i < 12; i++) {
      f.tx = W * (0.06 + Math.random() * 0.88); f.ty = H * (0.08 + Math.random() * 0.84);
      if (!(f.tx > box.x0 - 30 && f.tx < box.x1 + 30 && f.ty > box.y0 - 20 && f.ty < box.y1 + 20)) return;
    }
  }

  function nearestFood(f) {
    var best = null, bd = 1e9;
    for (var i = 0; i < food.length; i++) { var d = Math.hypot(food[i].x - f.x, food[i].y - f.y); if (d < bd) { bd = d; best = food[i]; } }
    return best;
  }

  function stepKoi(f, dt) {
    f.t += dt;
    var meal = nearestFood(f), gx = meal ? meal.x : f.tx, gy = meal ? meal.y : f.ty;
    if (!meal && Math.hypot(gx - f.x, gy - f.y) < 40) pickTarget(f);
    if (meal && Math.hypot(meal.x - f.x, meal.y - f.y) < 8) { meal.eaten = true; ripples.push({ x: meal.x, y: meal.y, r: 2, life: 0.8 }); }
    var want = Math.atan2(gy - f.y, gx - f.x);
    var d = Math.atan2(Math.sin(want - f.heading), Math.cos(want - f.heading));
    var turn = meal ? 1.8 : 0.7;
    f.heading += Math.max(-turn * dt, Math.min(turn * dt, d));
    var h = f.heading + 0.16 * Math.sin(f.t * 3.2);
    var sp = f.speed * (meal ? 1.7 : 1);
    f.x += Math.cos(h) * sp * dt; f.y += Math.sin(h) * sp * dt;
    f.trail.unshift([f.x, f.y, f.layer]);
    if (f.trail.length > 600) f.trail.length = 600;
  }

  function spine(f) {
    var seg = f.L / N, nodes = [[f.x, f.y, f.layer]], acc = 0, want = seg, tr = f.trail;
    for (var i = 1; i < tr.length && nodes.length <= N; i++) {
      var ax = tr[i - 1][0], ay = tr[i - 1][1], bx = tr[i][0], by = tr[i][1];
      var len = Math.hypot(bx - ax, by - ay);
      while (len > 0 && acc + len >= want && nodes.length <= N) {
        var q = (want - acc) / len;
        nodes.push([ax + (bx - ax) * q, ay + (by - ay) * q, tr[i][2]]);
        want += seg;
      }
      acc += len;
    }
    while (nodes.length <= N) {
      var last = nodes[nodes.length - 1];
      nodes.push([last[0] - Math.cos(f.heading) * seg, last[1] - Math.sin(f.heading) * seg, last[2]]);
    }
    return nodes;
  }

  // which colour a point of skin gets, from the variety and a noise pattern in body coordinates
  function skinRole(f, s, side) {
    var n = noise(s * 6 + f.seed, side * 1.6 + f.seed * 0.7);
    if (f.kind === 'ogon') return n > 0.72 ? 6 : 5;
    if (f.kind === 'tancho') return s < 0.13 && Math.abs(side) < 0.75 ? 6 : 1;
    if (f.kind === 'sanke' && noise(s * 14 + f.seed * 2, side * 3) > 0.78) return 8;
    return n > 0.44 && s < 0.74 ? 6 : 1;
  }

  function rasterKoi(f, nodes) {
    var L = f.L, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, pad = L * 0.2;
    for (var i = 0; i < nodes.length; i++) {
      minX = Math.min(minX, nodes[i][0]); maxX = Math.max(maxX, nodes[i][0]);
      minY = Math.min(minY, nodes[i][1]); maxY = Math.max(maxY, nodes[i][1]);
    }
    var c0 = Math.max(0, Math.floor((minX - pad) / cw)), c1 = Math.min(cols - 1, Math.ceil((maxX + pad) / cw));
    var r0 = Math.max(0, Math.floor((minY - pad) / CELL_H)), r1 = Math.min(rows - 1, Math.ceil((maxY + pad) / CELL_H));
    var rim = (cw * 0.9) / L, halo = (cw * 1.3) / L, lx = -0.5, ly = -0.6, lz = 0.62;
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
      var idx = r * cols + c;
      if (chars[idx] && chars[idx] !== ' ') continue;   // another koi already owns this cell
      var px = (c + 0.5) * cw, py = (r + 0.5) * CELL_H, best = 1e9, bs = 0, bj = 0, nx = 0, ny = 0, sgn = 1;
      for (var j = 0; j < N; j++) {
        var a = nodes[j], b = nodes[j + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
        var qx = a[0] + dx * t, qy = a[1] + dy * t, dist = Math.hypot(px - qx, py - qy);
        if (dist < best) {
          best = dist; bs = (j + t) / N; bj = t < 0.5 ? j : j + 1;
          nx = (px - qx) / (dist || 1); ny = (py - qy) / (dist || 1);
          sgn = dx * (py - a[1]) - dy * (px - a[0]) > 0 ? 1 : -1;
        }
      }
      var v = best / L, w = halfWidth(bs), ch = null, al = 1, ro = 1;
      if (v < w) {
        var rr = v / w;
        if (bs > 0.78) {
          // translucent tail fan: streaks along the fin rays
          ch = w - v < rim ? contour(nx, ny) : TAIL[Math.floor(hash(c, r) * TAIL.length)];
          ro = f.kind === 'ogon' ? 5 : 1; al = w - v < rim ? 0.85 : 0.5;
        } else {
          var z = Math.sqrt(1 - rr * rr), lit = Math.max(0, nx * rr * lx + ny * rr * ly + z * lz), dark = 1 - lit;
          ro = skinRole(f, bs, rr * sgn);
          var ramp = ro === 1 ? SKIN : PATCH;
          ch = ramp[Math.min(ramp.length - 1, Math.floor(dark * ramp.length))];
          al = ro === 1 ? 0.75 + 0.25 * dark : 0.9 + 0.1 * dark;
          if (ro === 8) { ro = 1; ch = '@'; al = 1; }
          // light page: white skin drawn like an ink painting, pale inside a dark outline
          else if (ro === 1 && colors.light) { ch = '.:;'[Math.min(2, Math.floor(dark * 3))]; ro = 4; al = 0.55; }
          if (w - v < rim) { ch = contour(nx, ny); al = 1; ro = ro === 5 ? 5 : 1; }
          if (Math.abs(bs - 0.06) < 0.02 && Math.abs(rr - 0.7) < 0.22) { ch = 'o'; ro = 1; al = 1; }
        }
      } else {
        var e = v - w, reach = 0.13;
        if (e < reach && bs > 0.17 && bs < 0.38) {
          var k = e / reach, lead = 0.18 + 0.1 * k, trail = 0.3 + 0.06 * k - 0.07 * k * k;
          if (bs > lead && bs < trail) { ch = reach - e < rim || bs - lead < rim ? contour(nx, ny) : TAIL[Math.floor(hash(c, r) * 4)]; al = 0.6; ro = f.kind === 'ogon' ? 5 : 1; }
        }
        if (!ch && e < halo) { chars[idx] = ' '; role[idx] = 0; layer[idx] = nodes[bj][2]; continue; }
      }
      if (ch) { chars[idx] = ch; role[idx] = ro; alpha[idx] = al; layer[idx] = nodes[bj][2]; }
    }
  }

  function stampRipple(rp) {
    var steps = Math.max(8, Math.floor(rp.r * 6.28 / cw));
    for (var i = 0; i < steps; i++) {
      var a = i / steps * 6.28, c = Math.floor((rp.x + Math.cos(a) * rp.r) / cw), r = Math.floor((rp.y + Math.sin(a) * rp.r * 0.8) / CELL_H);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      var idx = r * cols + c;
      if (chars[idx] && chars[idx] !== ' ') continue;
      chars[idx] = rp.life > 0.6 ? 'o' : '.'; role[idx] = 7; alpha[idx] = Math.min(0.8, rp.life);
    }
  }

  function frame(dt) {
    var total = cols * rows;
    if (!role || role.length !== total) { role = new Uint8Array(total); alpha = new Float32Array(total); layer = new Uint8Array(total); }
    chars.length = total; role.fill(0); layer.fill(BACK);
    for (var i = 0; i < total; i++) chars[i] = null;
    for (var w = 0; w < total; w++) wake[w] *= 0.97;

    var front_first = koi.slice().sort(function (a, b) { return b.layer - a.layer; });
    for (var k = 0; k < front_first.length; k++) {
      var f = front_first[k];
      stepKoi(f, dt);
      var nodes = spine(f);
      for (var n = 4; n < N; n += 3) {
        var wc = Math.floor(nodes[n][0] / cw), wr = Math.floor(nodes[n][1] / CELL_H);
        if (wc >= 0 && wc < cols && wr >= 0 && wr < rows) wake[wr * cols + wc] = Math.min(1, wake[wr * cols + wc] + 0.04);
      }
      rasterKoi(f, nodes);
    }

    food = food.filter(function (p) { p.age += dt; return !p.eaten && p.age < 14; });
    for (var p = 0; p < food.length; p++) {
      var fc = Math.floor(food[p].x / cw), fr = Math.floor(food[p].y / CELL_H);
      if (fc >= 0 && fc < cols && fr >= 0 && fr < rows) { var fi = fr * cols + fc; chars[fi] = '*'; role[fi] = 6; alpha[fi] = 1; }
    }
    ripples = ripples.filter(function (rp) { rp.r += 26 * dt; rp.life -= 0.45 * dt; return rp.life > 0.05; });
    for (var q = 0; q < ripples.length; q++) stampRipple(ripples[q]);

    for (var b = 0; b < total; b++) {
      if (chars[b]) continue;
      if (wake[b] > 0.06) { chars[b] = wake[b] > 0.3 ? '~' : '.'; role[b] = 2; alpha[b] = Math.min(0.7, wake[b] * 1.3); }
      else if (dots[b]) { chars[b] = '.'; role[b] = 4; alpha[b] = 0.32; }
    }
    draw();
  }

  function drawLayer(ctx, which, outline) {
    var fills = [null, colors.text, colors.link, colors.text, colors.dim, colors.orange, colors.red, colors.mid];
    if (outline) { ctx.strokeStyle = colors.bg; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; }
    for (var pass = 1; pass < fills.length; pass++) {
      ctx.fillStyle = fills[pass];
      for (var i = 0; i < chars.length; i++) {
        if (role[i] !== pass || layer[i] !== which) continue;
        var x = (i % cols) * cw, y = ((i / cols) | 0) * CELL_H;
        if (outline) { ctx.globalAlpha = Math.min(1, alpha[i] + 0.2); ctx.strokeText(chars[i], x, y); }
        ctx.globalAlpha = alpha[i];
        ctx.fillText(chars[i], x, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    bctx.fillStyle = colors.bg; bctx.fillRect(0, 0, W, H);
    drawLayer(bctx, BACK, false);
    fctx.clearRect(0, 0, W, H);
    drawLayer(fctx, FRONT, true);   // outlined so it reads on top of the photo
  }

  function toLocal(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  stage.addEventListener('pointermove', function (e) {
    pointer = toLocal(e);
    if (!lastRipple || Math.hypot(pointer.x - lastRipple.x, pointer.y - lastRipple.y) > 46) {
      ripples.push({ x: pointer.x, y: pointer.y, r: 2, life: 0.55 }); lastRipple = pointer;
    }
  });
  stage.addEventListener('pointerleave', function () { pointer = null; });
  stage.addEventListener('click', function (e) {
    var p = toLocal(e);
    if (inPhoto(p.x, p.y)) return;
    for (var i = 0; i < 3; i++) food.push({ x: p.x + (Math.random() - 0.5) * 22, y: p.y + (Math.random() - 0.5) * 14, age: 0 });
    ripples.push({ x: p.x, y: p.y, r: 3, life: 1 });
    if (food.length > 18) food.splice(0, food.length - 18);
  });

  function boot() {
    readColors(); resize(); settleKoi();
    frame(1 / 60);
    if (reduced) return;
    var last = performance.now();
    (function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      frame(dt);
      requestAnimationFrame(loop);
    })(last);
  }
  // the theme toggle swaps palettes without restarting the pond
  new MutationObserver(function () { readColors(); if (reduced && koi.length) frame(0.001); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', function () { if (koi.length) { resize(); frame(0.001); } });
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(function () { if (photo.complete) boot(); else { photo.addEventListener('load', boot); photo.addEventListener('error', boot); } });
})();
