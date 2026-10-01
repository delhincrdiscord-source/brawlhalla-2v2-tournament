/* Ambient layers: starfield + rising embers. Desktop-only cursor glow. */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ----- cursor glow (desktop, fine pointer only) -----
  if (window.matchMedia('(pointer: fine)').matches && !reduce) {
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    document.body.appendChild(glow);
    let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; });
    (function tick() {
      gx += (tx - gx) * 0.08;
      gy += (ty - gy) * 0.08;
      glow.style.left = gx + 'px';
      glow.style.top = gy + 'px';
      requestAnimationFrame(tick);
    })();
  }

  // ----- particles -----
  function makeCanvas(id, count, drawer) {
    const c = document.getElementById(id);
    if (!c || reduce) return;
    const ctx = c.getContext('2d');
    let w, h, parts;
    function resize() {
      w = c.width = innerWidth;
      h = c.height = innerHeight;
    }
    resize();
    addEventListener('resize', resize);
    parts = Array.from({ length: count }, drawer);
    (function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0 || p.y < -20 || p.y > h + 20) {
          Object.assign(p, drawer());
        }
        const a = Math.max(0, Math.min(1, p.life)) * p.baseA;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color.replace('A', a.toFixed(3));
        ctx.shadowColor = p.color.replace('A', '0.8');
        ctx.shadowBlur = p.glow;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      requestAnimationFrame(frame);
    })();
  }

  // starfield: static twinkling stars
  makeCanvas('stars', Math.min(140, innerWidth / 10), () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: Math.random() * 1.3 + 0.3,
    vx: 0.015,
    vy: 0,
    life: Math.random(),
    decay: Math.random() * 0.004 + 0.001,
    baseA: 0.7,
    glow: 4,
    color: 'rgba(200, 215, 255, A)',
  }));

  // embers: warm sparks + neon orbs drifting up from the bottom
  makeCanvas('embers', Math.min(60, innerWidth / 22), () => {
    const orb = Math.random() > 0.72;
    return {
      x: Math.random() * innerWidth,
      y: innerHeight + Math.random() * 120,
      r: orb ? Math.random() * 5 + 2.5 : Math.random() * 2.2 + 0.8,
      vx: (Math.random() - 0.5) * (orb ? 0.4 : 0.25),
      vy: -(Math.random() * 0.45 + (orb ? 0.28 : 0.15)),
      life: 1,
      decay: Math.random() * 0.0022 + 0.0008,
      baseA: orb ? 0.5 : 0.85,
      glow: orb ? 24 : 10,
      color: orb
        ? (Math.random() > 0.5 ? 'rgba(53, 230, 255, A)' : 'rgba(255, 78, 205, A)')
        : (Math.random() > 0.5 ? 'rgba(255, 180, 80, A)' : 'rgba(120, 220, 255, A)'),
    };
  });
})();
