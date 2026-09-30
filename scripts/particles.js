/**
 * ParticleSystem — простой пул частиц для брызг, пены и следа за утками.
 * Никаких изображений — всё рисуется примитивами Canvas, что дешево
 * по производительности и не требует загрузки ассетов.
 */
class ParticleSystem {
  constructor(maxParticles = 260) {
    this.max = maxParticles;
    this.particles = [];
  }

  spawnSplash(x, y, count = 6, color = 'rgba(255,255,255,0.9)') {
    for (let i = 0; i < count; i++) {
      this._push({
        x, y,
        vx: (Math.random() - 0.5) * 90,
        vy: -Math.random() * 70 - 20,
        life: 0.4 + Math.random() * 0.3,
        age: 0,
        r: 1.5 + Math.random() * 2.5,
        color,
        gravity: 220,
      });
    }
  }

  spawnWake(x, y, color = 'rgba(255,255,255,0.55)') {
    this._push({
      x, y,
      vx: (Math.random() - 0.5) * 10,
      vy: 8 + Math.random() * 6,
      life: 0.5,
      age: 0,
      r: 3 + Math.random() * 3,
      color,
      gravity: 0,
    });
  }

  spawnBurst(x, y, count = 20, colors = ['#FFD93D', '#FF6B5B', '#22D3EE', '#FFFFFF']) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      this._push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0.8 + Math.random() * 0.6,
        age: 0,
        r: 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: 240,
      });
    }
  }

  _push(p) {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push(p);
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

window.ParticleSystem = ParticleSystem;
