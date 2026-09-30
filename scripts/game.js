/**
 * game.js — оркестрация Duck Rush: Water Slide Race.
 *
 * Экспортирует единый публичный объект `DuckRushGame` с методами
 * startGame / pauseGame / resumeGame / destroyGame и колбэками
 * onWin(promoCode) / onLose() / onFinish(position), как требуется
 * для интеграции в чекаут тревел-сервиса.
 */
(function () {
  const OPPONENT_NAMES = ['Кряк', 'Пух', 'Плюх', 'Уточка', 'Крякер', 'Лужица',
    'Брызг', 'Плавник', 'Тина', 'Волна', 'Жёлтик'];

  class Game {
    constructor(root, cfg) {
      this.root = root;
      this.cfg = cfg;
      this.canvas = root.querySelector('#drCanvas');
      this.ctx = this.canvas.getContext('2d');
      this.ui = new UIManager(root, cfg);
      this.audio = new AudioManager(cfg.soundDefaultOn);
      this.particles = new ParticleSystem();
      this.accelIndicator = root.querySelector('#drAccelIndicator');
      this._wasAccelerating = false;

      this.running = false;
      this.paused = false;
      this.finishedHandled = false;
      this.rafId = null;
      this.lastTs = null;
      this.elapsed = 0;

      this.finishOrder = [];
      this._finishedSet = new Set();

      this.callbacks = {};

      this._bindStaticUI();
      this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
      this._resizeObserver.observe(this.root);
      this._resizeCanvas();
    }

    _bindStaticUI() {
      this.ui.muteBtn.addEventListener('click', () => {
        const isOn = this.audio.toggle();
        this.ui.setMuted(isOn);
      });
      this.ui.setMuted(this.audio.enabled);

      this.input = new InputController({
        dragSurface: this.root,
        dragSensitivityPx: this.cfg.dragSteerSensitivityPx,
        keyboardRamp: this.cfg.keyboardSteerRamp,
      });
    }

    _resizeCanvas() {
      const rect = this.root.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewW = rect.width;
      this.viewH = rect.height;
    }

    // -------------------------------------------------------------
    // Настройка новой гонки
    // -------------------------------------------------------------
    setupRace() {
      const cfg = this.cfg;
      this.track = new Track(cfg);
      this.elapsed = 0;
      this.finishOrder = [];
      this._finishedSet = new Set();
      this.finishedHandled = false;

      const baseSpeed = cfg.trackLength / cfg.raceDurationTarget;

      this.player = new Duck({
        id: 'player', name: 'Вы', isPlayer: true,
        color: cfg.colors.sunYellow, track: this.track,
        baseSpeed: baseSpeed * (0.97 + Math.random() * 0.06),
        steerAgility: cfg.playerSteerAgility || 5.5,
      });

      this.aiDucks = [];
      this.aiControllers = [];
      const shuffledNames = [...OPPONENT_NAMES].sort(() => Math.random() - 0.5);
      for (let i = 0; i < cfg.opponents; i++) {
        const hue = [0.0, 0.08, 0.14, -0.06][i % 4];
        const duck = new Duck({
          id: `ai_${i}`, name: shuffledNames[i % shuffledNames.length], isPlayer: false,
          color: this._shiftColor(cfg.colors.sunYellow, hue),
          track: this.track,
          baseSpeed: baseSpeed * (0.9 + Math.random() * 0.22),
          steerAgility: (cfg.aiSteerAgility || 3.2) * (0.85 + Math.random() * 0.3),
        });
        duck._baseSpeedOriginal = duck.baseSpeed;
        duck.x = (i - cfg.opponents / 2) * 22;
        this.aiDucks.push(duck);
        this.aiControllers.push(new AIController(duck, this.track, cfg));
      }
      this.player.x = 0;

      this.allDucks = [this.player, ...this.aiDucks];
      this.balancer = new DifficultyDirector(cfg, this.track);

      this.ui.setTotalRacers(this.allDucks.length);
      this.ui.updateHUD({ position: 1, progressRatio: 0, elapsed: 0 });
      this.ui.hideResults();
      this._wasAccelerating = false;
      this.accelIndicator.classList.remove('show');

      // Подсказка по управлению зависит от типа устройства
      const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
      this.ui.hintEl.textContent = isTouch
        ? 'Двигайте уточку пальцем влево/вправо'
        : 'Стрелки ← / → — руль, ↑ — ускорение';
      this.ui.showHint();
    }

    _shiftColor(hex, t) {
      // лёгкая вариация оттенка утят-соперников, чтобы отличать их друг от друга
      const c = parseInt(hex.slice(1), 16);
      let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      r = Math.max(0, Math.min(255, r - t * 120));
      g = Math.max(0, Math.min(255, g - t * 60));
      b = Math.max(0, Math.min(255, b + t * 180));
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    }

    // -------------------------------------------------------------
    // Запуск / жизненный цикл
    // -------------------------------------------------------------
    async start(callbacks = {}) {
      this.callbacks = callbacks || {};
      this.setupRace();
      this.running = true;
      this.paused = false;
      this.audio.startMusic();

      await this.ui.runCountdown(this.cfg.countdownSeconds, (isFinal) => this.audio.countdownBeep(isFinal));
      this.ui.showHint();
      setTimeout(() => this.ui.hideHint(), 3500);

      this.lastTs = performance.now();
      this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }

    pause() {
      if (!this.running) return;
      this.paused = true;
      this.audio.stopMusic();
    }

    resume() {
      if (!this.running) return;
      this.paused = false;
      this.lastTs = performance.now();
      this.audio.startMusic();
      if (!this.rafId) this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }

    destroy() {
      this.running = false;
      this.paused = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.audio.stopMusic();
      this.ui.hideResults();
      if (this.input) this.input.destroy();
      if (this._resizeObserver) this._resizeObserver.disconnect();
    }

    playAgain() {
      this.ui.hideResults();
      this.start(this.callbacks);
    }

    _loop(ts) {
      if (!this.running) return;
      if (this.paused) { this.rafId = null; return; }

      const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
      this.lastTs = ts;
      this.elapsed += dt;

      this.update(dt);
      this.render();

      this.rafId = requestAnimationFrame((t) => this._loop(t));
    }

    // -------------------------------------------------------------
    // Обновление симуляции
    // -------------------------------------------------------------
    update(dt) {
      const cfg = this.cfg;

      // Управление игроком: руль (стрелки/A-D на десктопе или drag пальцем
      // на мобильных) + ускорение (удержание ↑/W — работает только на
      // десктопе, поскольку input.accelerate выставляется клавиатурой).
      this.input.update(dt); // плавно подводит клавиатурный руль к текущей цели
      const steer = this.input.steer;
      const halfWidth = this.track.widthAt(this.player.s) / 2 - 18;
      this.player.targetX = steer * halfWidth * cfg.steerSensitivity;

      const wasAccelerating = this._wasAccelerating;
      const isAccelerating = !!this.input.accelerate;
      this.player.accelerateMult = isAccelerating ? cfg.accelerateSpeedMult : 1;
      if (isAccelerating !== wasAccelerating) {
        this.accelIndicator.classList.toggle('show', isAccelerating);
        this._wasAccelerating = isAccelerating;
      }

      this.player.update(dt, cfg);
      for (let i = 0; i < this.aiDucks.length; i++) {
        this.aiControllers[i].update(dt, this.allDucks);
        this.aiDucks[i].update(dt, cfg);
      }
      this.balancer.update(dt, this.player, this.aiDucks);

      // Подбор бустов
      for (const duck of this.allDucks) {
        for (const b of this.track.boosts) {
          if (b.taken) continue;
          if (Math.abs(duck.s - b.s) < 26 && Math.abs(duck.x - b.xOffset) < 30) {
            b.taken = true;
            duck.applyBoost(b.type, cfg);
            if (duck.isPlayer) {
              const spec = cfg.boosts[b.type];
              const labels = { turbo: 'Турбо!', wave: 'Волна!', lifebuoy: 'Спасательный круг!' };
              this.ui.flashBoost(spec.icon, labels[b.type] || '');
              this.audio.boost();
            }
            // Позиция для эффекта частиц вычисляется в render() (там доступна
            // проекция мировых координат утки в экранные worldToScreen()).
            duck._justBoosted = true;
          }
        }
      }

      // Случайные утиные "кряки" для атмосферы (визуальный след воды — в render())
      if (Math.random() < dt * 0.6) this.audio.quack();

      this.particles.update(dt);

      // Отслеживание финишей
      for (const duck of this.allDucks) {
        if (duck.finished && !this._finishedSet.has(duck.id)) {
          this._finishedSet.add(duck.id);
          this.finishOrder.push(duck);
          if (!duck.isPlayer) this.audio.splash();
        }
      }

      // HUD
      const rankedList = this._computeRanking();
      const playerRank = rankedList.indexOf(this.player) + 1;
      this.ui.updateHUD({
        position: playerRank,
        progressRatio: this.player.progressRatio,
        elapsed: this.elapsed,
      });

      if (this.player.finished && !this.finishedHandled) {
        this.finishedHandled = true;
        this._handleFinish(playerRank);
      }
    }

    _computeRanking() {
      const finishedIds = this.finishOrder.map((d) => d.id);
      return [...this.allDucks].sort((a, b) => {
        const ai = finishedIds.indexOf(a.id);
        const bi = finishedIds.indexOf(b.id);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.s - a.s;
      });
    }

    _handleFinish(rank) {
      this.audio.applause();
      this.particles.spawnBurst(this.viewW / 2, this.viewH * 0.35, 40);
      setTimeout(() => {
        const won = rank === 1;
        this.ui.showResults({
          won,
          position: rank,
          promoCode: this.cfg.promoCode,
          discountPercent: this.cfg.discountPercent,
          onPlayAgain: () => this.playAgain(),
          onApplyPromo: (code) => {
            if (typeof window.applyPromoCode === 'function') window.applyPromoCode(code);
          },
        });
        // onWin/onLose сигнализируют об исходе гонки сразу при показе экрана
        // результатов; onApplyPromo (клик по кнопке) — отдельное событие
        // "игрок решил воспользоваться скидкой", которое обрабатывает сам сервис.
        if (won && this.callbacks.onWin) this.callbacks.onWin(this.cfg.promoCode);
        if (!won && this.callbacks.onLose) this.callbacks.onLose();
        if (this.callbacks.onFinish) this.callbacks.onFinish(rank);
      }, 650);

      this.running = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // -------------------------------------------------------------
    // Рендер
    // -------------------------------------------------------------
    render() {
      const ctx = this.ctx;
      const w = this.viewW, h = this.viewH;
      const cfg = this.cfg;
      ctx.clearRect(0, 0, w, h);

      // Фон — глубокая вода с лёгким градиентом
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, cfg.colors.waterMid);
      bg.addColorStop(1, cfg.colors.waterDeep);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const midX = w / 2;
      const playerScreenY = h * 0.7;
      const scaleY = 0.85;
      const centerAtCam = this.track.centerAt(this.player.s);

      const sTop = this.player.s + (playerScreenY / scaleY);
      const sBottom = this.player.s - ((h - playerScreenY) / scaleY);
      const step = 18;

      // --- Русло горки (широкая лента) ---
      ctx.beginPath();
      let started = false;
      const leftPts = [], rightPts = [];
      for (let s = sBottom; s <= sTop; s += step) {
        const cx = midX + this.track.centerAt(s) - centerAtCam;
        const width = this.track.widthAt(s);
        const sy = playerScreenY - (s - this.player.s) * scaleY;
        leftPts.push([cx - width / 2, sy]);
        rightPts.push([cx + width / 2, sy]);
      }
      ctx.moveTo(leftPts[0][0], leftPts[0][1]);
      for (const p of leftPts) ctx.lineTo(p[0], p[1]);
      for (let i = rightPts.length - 1; i >= 0; i--) ctx.lineTo(rightPts[i][0], rightPts[i][1]);
      ctx.closePath();
      const channelGrad = ctx.createLinearGradient(0, 0, 0, h);
      channelGrad.addColorStop(0, cfg.colors.waterLight);
      channelGrad.addColorStop(1, '#BDEFFA');
      ctx.fillStyle = channelGrad;
      ctx.fill();

      // Пенные края русла
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(leftPts[0][0], leftPts[0][1]);
      for (const p of leftPts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rightPts[0][0], rightPts[0][1]);
      for (const p of rightPts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();

      const worldToScreen = (s, xOffset) => {
        const sx = midX + this.track.centerAt(s) - centerAtCam + xOffset;
        const sy = playerScreenY - (s - this.player.s) * scaleY;
        return [sx, sy];
      };

      // --- Полосы течения (визуальная рябь) ---
      ctx.save();
      ctx.globalAlpha = 0.16;
      for (const zone of this.track.currentZones) {
        if (zone.end < sBottom || zone.start > sTop) continue;
        const s1 = Math.max(zone.start, sBottom);
        const s2 = Math.min(zone.end, sTop);
        const [x1, y1] = worldToScreen(s1, 0);
        const [, y2] = worldToScreen(s2, 0);
        const width = this.track.widthAt((s1 + s2) / 2);
        ctx.fillStyle = zone.mult > 1.15 ? '#0EA5E9' : '#0891B2';
        ctx.fillRect(x1 - width / 2, y2, width, y1 - y2);
      }
      ctx.restore();

      // --- Трамплины ---
      for (const ramp of this.track.ramps) {
        if (ramp.s < sBottom || ramp.s > sTop) continue;
        const [x, y] = worldToScreen(ramp.s, 0);
        const width = this.track.widthAt(ramp.s);
        ctx.fillStyle = 'rgba(255, 217, 61, 0.55)';
        ctx.fillRect(x - width / 2, y - 5, width, 10);
      }

      // --- Водовороты ---
      const swirl = this.elapsed * 3;
      for (const wp of this.track.whirlpools) {
        if (wp.s < sBottom || wp.s > sTop) continue;
        const width = this.track.widthAt(wp.s);
        const xOffset = wp.xOffset * (width / 2 - 20);
        const [x, y] = worldToScreen(wp.s, xOffset);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(swirl);
        ctx.strokeStyle = 'rgba(8,145,178,0.5)';
        ctx.lineWidth = 3;
        for (let r = 6; r <= wp.radius * 0.6; r += 10) {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0.3, Math.PI * 1.4);
          ctx.stroke();
        }
        ctx.restore();
      }

      // --- Бусты ---
      const bob = Math.sin(this.elapsed * 4) * 4;
      for (const b of this.track.boosts) {
        if (b.taken || b.s < sBottom || b.s > sTop) continue;
        const [x, y] = worldToScreen(b.s, b.xOffset);
        const spec = cfg.boosts[b.type];
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + bob, 16, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fill();
        ctx.strokeStyle = spec.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(spec.icon, x, y + bob + 1);
        ctx.restore();
      }

      // --- Финишная линия ---
      if (this.track.finishS >= sBottom && this.track.finishS <= sTop) {
        const width = this.track.widthAt(this.track.finishS);
        const [x, y] = worldToScreen(this.track.finishS, 0);
        const tile = 14;
        for (let i = 0; i < width / tile; i++) {
          ctx.fillStyle = i % 2 === 0 ? '#073B4C' : '#FFFFFF';
          ctx.fillRect(x - width / 2 + i * tile, y - 6, tile, 12);
        }
      }

      // --- Частицы (под утками) ---
      this.particles.draw(ctx);

      // --- Утки ---
      const sorted = [...this.allDucks].sort((a, b) => a.s - b.s);
      for (const duck of sorted) {
        this._drawDuck(ctx, duck, worldToScreen);
        if (duck._justBoosted) {
          const [x, y] = worldToScreen(duck.s, duck.x);
          this.particles.spawnBurst(x, y, 8);
          duck._justBoosted = false;
        }
        // след воды
        if (Math.random() < 0.5) {
          const [x, y] = worldToScreen(duck.s - 8, duck.x);
          this.particles.spawnWake(x, y + 10);
        }
      }
    }

    _drawDuck(ctx, duck, worldToScreen) {
      const [x, y0] = worldToScreen(duck.s, duck.x);
      const y = y0 - (duck.bounceHeight || 0);
      const scale = duck.isPlayer ? 1.15 : 1.0;

      ctx.save();
      // тень на воде
      ctx.beginPath();
      ctx.ellipse(x, y0 + 10, 15 * scale, 6 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(7,59,76,0.22)';
      ctx.fill();

      ctx.translate(x, y);
      ctx.rotate((duck.tilt || 0) * Math.PI / 180 * 0.3);
      ctx.scale(scale, scale);

      // тело
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = duck.color;
      ctx.fill();
      if (duck.isPlayer) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#FF6B5B';
        ctx.stroke();
      }

      // голова
      ctx.beginPath();
      ctx.arc(0, -12, 8, 0, Math.PI * 2);
      ctx.fillStyle = duck.color;
      ctx.fill();

      // клюв
      ctx.beginPath();
      ctx.moveTo(5, -12);
      ctx.lineTo(13, -10);
      ctx.lineTo(5, -8);
      ctx.closePath();
      ctx.fillStyle = '#FF9A3C';
      ctx.fill();

      // глаз
      ctx.beginPath();
      ctx.arc(2, -14, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#073B4C';
      ctx.fill();

      // крыло
      ctx.beginPath();
      ctx.ellipse(-4, 2, 7, 5, 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fill();

      ctx.restore();

      // Оглушение — короткие искры
      if (duck.stunTimer > 0) {
        ctx.save();
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💫', x, y - 26);
        ctx.restore();
      }
    }
  }

  // ===================================================================
  // Публичный API для встраивания в тревел-платформу
  // ===================================================================
  let instance = null;

  window.DuckRushGame = {
    /**
     * Запускает игру. callbacks: { onWin(promoCode), onLose(), onFinish(position) }
     */
    startGame(callbacks) {
      const root = document.getElementById('duckRushRoot');
      if (!root) {
        console.error('Duck Rush: контейнер #duckRushRoot не найден на странице.');
        return;
      }
      if (!instance) instance = new Game(root, window.DUCK_RUSH_CONFIG);
      instance.start(callbacks);
    },
    pauseGame() { if (instance) instance.pause(); },
    resumeGame() { if (instance) instance.resume(); },
    destroyGame() {
      if (instance) {
        instance.destroy();
        instance = null;
      }
    },
  };
})();
