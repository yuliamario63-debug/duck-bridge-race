/**
 * Duck — одна утка на трассе (игрок или ИИ).
 * Физика скольжения: постоянное движение вперёд (s растёт),
 * скорость зависит от течения трассы + бустов, боковое положение (x)
 * плавно следует к целевому смещению (управление или ИИ-логика),
 * добавлены лёгкий bounce (вертикальная волна) и наклон в поворотах.
 */
class Duck {
  constructor({ id, name, isPlayer, color, track, baseSpeed, steerAgility }) {
    this.id = id;
    this.name = name;
    this.isPlayer = !!isPlayer;
    this.color = color;
    this.track = track;

    this.s = 0;                 // прогресс вдоль трассы
    this.x = 0;                 // боковое смещение относительно центра русла
    this.targetX = 0;           // куда стремится x (задаётся управлением/ИИ)
    this.vBounce = 0;
    this.bouncePhase = Math.random() * Math.PI * 2;
    this.tilt = 0;

    // Насколько быстро утка "довороачивается" к targetX. У игрока управление
    // отзывчивое (высокое значение), у ИИ — заметно более плавное, чтобы
    // соперники скользили спокойно, а не дёргались рядом с игроком.
    this.steerAgility = steerAgility || (this.isPlayer ? 9 : 3.2);

    this.baseSpeed = baseSpeed; // ед./сек при течении x1
    this.speedMult = 1;
    this.boostTimer = 0;
    this.stunTimer = 0;
    this.finished = false;
    this.finishTime = null;
    this.finishRank = null;

    // ---- Поля для динамической сложности (DDA) ----------------------
    // Все по умолчанию нейтральны (1 = без эффекта, 0 = без эффекта).
    // Значения выставляются извне DifficultyDirector'ом каждый кадр и
    // плавно интерполируются им же — сама утка ничего не "знает" о DDA,
    // просто использует текущие коэффициенты в своей физике.
    this.assistSpeedMult = 1;     // множитель скорости от помощи (для игрока)
    this.boostEfficiency = 1;      // насколько сильнее действуют бусты
    this.corneringAssist = 0;       // 0..1, снижает штраф от водоворотов/поворотов
    this.handicapSpeedMult = 1;      // множитель скорости от гандикапа (для ИИ)
    this.mistakeBoost = 0;            // 0..1, повышает частоту "ошибок" ИИ
    this._activeTurboMult = null;
    this.accelerateMult = 1;           // множитель от удержания клавиши ускорения (игрок, десктоп)

    this.trailParticleAccum = 0;
    this.wakeOffset = 0; // визуальный "хвост" смещения для следа
  }

  get progressRatio() {
    return Math.min(1, this.s / this.track.length);
  }

  applyBoost(type, cfg) {
    const spec = cfg.boosts[type];
    if (!spec) return;
    if (type === 'turbo') {
      this.boostTimer = Math.max(this.boostTimer, spec.duration);
      // Эффективность буста может быть незаметно усилена DDA (boostEfficiency),
      // фиксируется на момент подбора, чтобы не "плавать" посреди действия буста.
      this._activeTurboMult = spec.speedMult * (this.boostEfficiency || 1);
    } else if (type === 'wave') {
      this.s += spec.impulse * 0.15 * (this.boostEfficiency || 1); // мгновенный толчок вперёд
    } else if (type === 'lifebuoy') {
      this.stunTimer = Math.max(0, this.stunTimer - spec.reduceStunTime);
    }
  }

  stun(duration) {
    this.stunTimer = Math.max(this.stunTimer, duration);
  }

  update(dt, cfg) {
    if (this.finished) return;

    // Боковое движение плавно тянется к цели (пружинный демпфер).
    // steerAgility задаёт "жёсткость" довода к targetX: у игрока —
    // отзывчиво, у ИИ — мягко и плавно (без резких скачков).
    const steerLerp = 1 - Math.pow(0.001, dt);
    this.x += (this.targetX - this.x) * Math.min(1, steerLerp * this.steerAgility);

    // Ограничение боковым краем русла
    const halfWidth = this.track.widthAt(this.s) / 2 - 18;
    if (this.x > halfWidth) this.x = halfWidth;
    if (this.x < -halfWidth) this.x = -halfWidth;

    // Водовороты слегка тянут утку к своему центру и создают лёгкое замедление.
    // corneringAssist (0..1, задаётся DifficultyDirector'ом) снижает этот штраф
    // для игрока, когда он отстаёт — выглядит как "удачное прохождение поворота".
    let whirlpoolSlow = 1;
    for (const wp of this.track.whirlpools) {
      const ds = this.s - wp.s;
      if (Math.abs(ds) < wp.radius) {
        const pull = (1 - Math.abs(ds) / wp.radius);
        const poolX = wp.xOffset * (this.track.widthAt(wp.s) / 2 - 20);
        this.x += (poolX - this.x) * pull * 0.06;
        whirlpoolSlow *= (1 - pull * 0.35);
      }
    }
    if (this.corneringAssist > 0) {
      whirlpoolSlow = 1 - (1 - whirlpoolSlow) * (1 - this.corneringAssist);
    }

    // Скорость: базовая * течение трассы * водоворот * буст * помощь/гандикап
    // * ускорение (удержание ↑/W) * (0.15 если оглушён)
    const current = this.track.currentSpeedAt(this.s);
    let mult = current * whirlpoolSlow * (this.assistSpeedMult || 1) * (this.handicapSpeedMult || 1) * (this.accelerateMult || 1);
    if (this.boostTimer > 0) {
      mult *= (this._activeTurboMult || cfg.boosts.turbo.speedMult);
      this.boostTimer -= dt;
    }
    if (this.stunTimer > 0) {
      mult = 0.15;
      this.stunTimer -= dt;
    }
    this.speedMult = mult;

    const speed = this.baseSpeed * mult;
    this.s += speed * dt;

    // Прыжок на трамплине — короткий импульс + визуальный bounce всплеск
    for (const ramp of this.track.ramps) {
      if (Math.abs(this.s - ramp.s) < 6 && !this._lastRampHit) {
        this.vBounce = 5.5;
        this._lastRampHit = ramp.s;
      }
    }
    if (this._lastRampHit && Math.abs(this.s - this._lastRampHit) > 40) {
      this._lastRampHit = null;
    }

    // Лёгкое покачивание на волнах (постоянное, декоративное) + затухание прыжка
    this.bouncePhase += dt * 6;
    this.vBounce *= Math.pow(0.02, dt);
    this.bounceHeight = Math.sin(this.bouncePhase) * 2.2 + this.vBounce;

    // Наклон в поворотах — пропорционален кривизне трассы и скорости бокового смещения
    const curvature = this.track.curvatureAt(this.s);
    this.tilt = this._smoothTilt(curvature * 140 + (this.targetX - this.x) * -0.02);

    if (this.s >= this.track.finishS && !this.finished) {
      this.finished = true;
      this.finishTime = performance.now();
    }
  }

  _smoothTilt(target) {
    const prev = this._tilt || 0;
    const next = prev + (target - prev) * 0.15;
    this._tilt = next;
    return next;
  }
}

window.Duck = Duck;
