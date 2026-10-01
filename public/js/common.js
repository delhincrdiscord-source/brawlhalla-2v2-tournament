/* Shared UI helpers: scroll reveal, 3D tilt, toasts, status fetching, crest */
function revealInit() {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

/* Mouse-tracked 3D tilt for .tilt3d glass cards (desktop only) */
function tiltInit() {
  if (!window.matchMedia('(pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.tilt3d').forEach((el) => {
    let raf = null;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--ry', (px * 9).toFixed(2) + 'deg');
        el.style.setProperty('--rx', (-py * 9).toFixed(2) + 'deg');
        el.style.setProperty('--mx', ((px + 0.5) * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((py + 0.5) * 100).toFixed(1) + '%');
        raf = null;
      });
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  });
}

function toast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3800);
}

// Escape user-supplied strings before interpolating into HTML templates
// (team names are attacker-controlled via the register form).
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function fetchStatus() {
  const res = await fetch('/api/status');
  return res.json();
}

/* BRAWLHALLA crest — winged hex core with lightning bolt, crossed blades, spinning orbit */
function crestSVG(cls) {
  return `<svg class="${cls}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff6d6"/><stop offset="0.45" stop-color="#ffc24b"/><stop offset="1" stop-color="#ff7a1e"/>
      </linearGradient>
      <linearGradient id="gCyan" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#7af5ff"/><stop offset="1" stop-color="#3f7bff"/>
      </linearGradient>
      <linearGradient id="gMag" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff4ecd"/><stop offset="1" stop-color="#8b5cf6"/>
      </linearGradient>
      <linearGradient id="gBolt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#ffe14d"/><stop offset="1" stop-color="#ff8a2e"/>
      </linearGradient>
      <linearGradient id="gPlate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2a1f5e"/><stop offset="1" stop-color="#0d0b24"/>
      </linearGradient>
      <radialGradient id="gCore" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ff9d2e" stop-opacity="0.55"/><stop offset="0.55" stop-color="#ff4ecd" stop-opacity="0.18"/><stop offset="1" stop-color="#ff4ecd" stop-opacity="0"/>
      </radialGradient>
      <filter id="fGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2.2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    <!-- spinning outer orbit ring with energy nodes -->
    <g class="crest-spin">
      <circle cx="50" cy="50" r="47" stroke="url(#gMag)" stroke-width="1.6" opacity="0.75" stroke-dasharray="10 5 2 5"/>
      <circle cx="97" cy="50" r="2.6" fill="#ff4ecd" filter="url(#fGlow)"/>
      <circle cx="3" cy="50" r="1.8" fill="#ffc24b"/>
    </g>
    <circle cx="50" cy="50" r="41.5" stroke="url(#gGold)" stroke-width="1.2" opacity="0.5"/>

    <!-- pulsing energy core -->
    <circle class="crest-pulse" cx="50" cy="50" r="34" fill="url(#gCore)"/>

    <!-- wings -->
    <path d="M50 26 C38 20 24 20 14 27 C24 28 32 31 38 36 C30 35 22 37 16 42 C26 42 33 45 38 49 C33 49 28 52 25 56 C33 55 40 55 45 57 L50 50 Z" fill="url(#gCyan)" opacity="0.85"/>
    <path d="M50 26 C62 20 76 20 86 27 C76 28 68 31 62 36 C70 35 78 37 84 42 C74 42 67 45 62 49 C67 49 72 52 75 56 C67 55 60 55 55 57 L50 50 Z" fill="url(#gGold)" opacity="0.9"/>

    <!-- hexagonal shield plate -->
    <path d="M50 18 L74 29 V54 C74 68 64 79 50 86 C36 79 26 68 26 54 V29 Z" fill="url(#gPlate)" stroke="url(#gGold)" stroke-width="2.4" filter="url(#fGlow)"/>
    <path d="M50 24 L69 33 V54 C69 65 61 74 50 80 C39 74 31 65 31 54 V33 Z" stroke="url(#gCyan)" stroke-width="1" opacity="0.55" stroke-dasharray="4 3"/>

    <!-- crossed blades -->
    <path d="M35 34 L62 66 L58 70 L48 62 L44 66 L40 62 L45 56 Z" fill="url(#gGold)" opacity="0.95"/>
    <path d="M65 34 L38 66 L42 70 L52 62 L56 66 L60 62 L55 56 Z" fill="url(#gCyan)" opacity="0.95"/>
    <circle cx="57.5" cy="68.5" r="2" fill="#ffc24b"/>
    <circle cx="42.5" cy="68.5" r="2" fill="#7af5ff"/>

    <!-- lightning focal bolt -->
    <path class="shimmer" d="M55 28 L39 54 L49 54 L43 76 L64 44 L52 44 L61 28 Z" fill="url(#gBolt)" filter="url(#fGlow)"/>

    <!-- 2v2 banner -->
    <rect x="32" y="82" width="36" height="12" rx="6" fill="#0d0b24" stroke="url(#gMag)" stroke-width="1.4"/>
    <text x="50" y="90.5" text-anchor="middle" font-family="Orbitron, sans-serif" font-weight="800" font-size="7.5" fill="url(#gMag)" letter-spacing="1.5">2V2</text>
  </svg>`;
}

function markActiveNav() {
  const path = location.pathname;
  document.querySelectorAll('.nav-links a').forEach((a) => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
}

/* ---------- team flair: deterministic per-name gradient banner ---------- */
function teamColors(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 60 + (h % 90)) % 360;
  return {
    a: `hsl(${h1}, 85%, 60%)`,
    b: `hsl(${h2}, 80%, 55%)`,
    grad: `linear-gradient(90deg, hsl(${h1},85%,60%), hsl(${h2},80%,55%))`,
  };
}
function teamBanner(name, cls) {
  const c = teamColors(name);
  return `<span class="team-banner ${cls || ''}" style="background:${c.grad}"></span>`;
}

/* ---------- nav progress ring: tournament completion around the crest ---------- */
function navRingInit() {
  const holder = document.getElementById('navCrest');
  if (!holder) return;
  fetch('/api/bracket').then((r) => r.json()).then((data) => {
    const b = data.bracket;
    if (!b) return;
    const real = (m) => m && !m.isBye;
    let total = 0, done = 0;
    const all = [...b.winners.rounds, ...b.losers.rounds].flatMap((r) => r.matches);
    for (const m of all.concat([b.grandFinal, b.grandFinalReset]).filter(real)) {
      total++;
      if (m.winner) done++;
    }
    if (!total) return;
    const pct = done / total;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 44 44');
    ring.setAttribute('class', 'nav-ring');
    ring.innerHTML = `
      <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2.5"/>
      <circle cx="22" cy="22" r="20" fill="none" stroke="url(#ringGrad)" stroke-width="2.5"
        stroke-linecap="round" stroke-dasharray="${(pct * 125.6).toFixed(1)} 125.6"
        transform="rotate(-90 22 22)"/>
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffc24b"/><stop offset="1" stop-color="#35e6ff"/>
      </linearGradient></defs>`;
    ring.title = `Tournament progress: ${done}/${total} matches played`;
    holder.appendChild(ring);
  }).catch(() => {});
}

/* ---------- CRT / broadcast scanline toggle ---------- */
function crtInit() {
  const btn = document.createElement('button');
  btn.id = 'crtToggle';
  btn.title = 'Toggle broadcast CRT mode';
  btn.textContent = '📺';
  document.body.appendChild(btn);
  if (localStorage.getItem('crtMode') === '1') document.body.classList.add('crt');
  btn.addEventListener('click', () => {
    const on = document.body.classList.toggle('crt');
    localStorage.setItem('crtMode', on ? '1' : '0');
  });
}

/* ---------- odometer roll: animate digits rolling when count changes ---------- */
function odometerInit() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    if (el.dataset.odo) return;
    el.dataset.odo = '1';
    let current = null;
    const render = (val) => {
      const digits = String(val).split('');
      el.innerHTML = digits.map((d) => `<span class="odo-col"><span class="odo-digit">${d}</span></span>`).join('');
    };
    const animate = (from, to) => {
      const fs = String(from).split('');
      const ts = String(to).split('');
      while (fs.length < ts.length) fs.unshift('0');
      el.innerHTML = fs.map((d, i) => {
        const t = Number(ts[i]);
        const f = Number(d);
        if (f === t) return `<span class="odo-col"><span class="odo-digit">${t}</span></span>`;
        const steps = [];
        for (let n = f; ; n = (n + 1) % 10) {
          steps.push(`<span class="odo-digit">${n}</span>`);
          if (n === t) break;
        }
        return `<span class="odo-col"><span class="odo-strip" style="--steps:${steps.length - 1}">${steps.join('')}</span></span>`;
      }).join('');
    };
    const mo = new MutationObserver(() => {
      const target = Number(el.dataset.count) || 0;
      if (target === current) return;
      if (current === null) { render(target); current = target; return; }
      const from = current;
      current = target;
      animate(from, target);
      el.classList.remove('odo-run');
      void el.offsetWidth;
      el.classList.add('odo-run');
      setTimeout(() => render(target), 1100);
    });
    mo.observe(el, { attributes: true, attributeFilter: ['data-count'] });
  });
}
