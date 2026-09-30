/**
 * AIController — управляет одной ИИ-уткой: выбирает целевое боковое
 * смещение (targetX), иногда "ошибается", гоняется за бустами,
 * периодически сама разгоняется. Частота и заметность ошибок слегка
 * растут, если DifficultyDirector выставил утке mistakeBoost > 0
 * (т.е. игрок в данный момент отстаёт и ей "не везёт чуть больше").
 *
 * DifficultyDirector — отдельно следит за ОБЩИМ раскладом гонки и
 * реализует динамическую сложность (DDA): если игрок отстаёт, плавно
 * растёт его максимальная скорость, эффективность бустов и прохождение
 * поворотов, а ближайший соперник-лидер чуть теряет скорость и чаще
 * ошибается. Если игрок уже лидирует — помощь отключена. На последних
 * ~20% трассы гарантируется, что игрок выйдет вперёд с правдоподобным
 * разрывом (0.2–2 сек), а не за счёт скачков скорости или телепортов —
 * все коэффициенты меняются только через плавное экспоненциальное
 * сглаживание, кадр за кадром.
 */
class AIController {
  constructor(duck, track, cfg) {
    this.duck = duck;
    this.track = track;
    this.cfg = cfg;
    this.weavePhase = Math.random() * Math.PI * 2;
    // Более медленная и мелкая "змейка" — соперники плавно покачиваются
    // в своём потоке, а не мечутся из стороны в сторону.
    this.weaveSpeed = 0.22 + Math.random() * 0.22;
    this.weaveAmp = 10 + Math.random() * 16;
    this.mistakeTimer = 5 + Math.random() * 6;
    this.mistakeActive = 0;
    this.pushOffset = 0; // сглаженное смещение от столкновений (не дёргается мгновенно)
    this.personality = {
      aggression: 0.4 + Math.random() * 0.6,   // насколько активно охотится за бустами
      wobble: 0.25 + Math.random() * 0.4,        // склонность к "ошибкам" (снижена для плавности)
    };
  }

  update(dt, allDucks) {
    const duck = this.duck;
    if (duck.finished) return;

    const mistakeBoost = duck.mistakeBoost || 0; // 0..1, задаётся DifficultyDirector'ом
    const wobbleFactor = this.personality.wobble * (1 + mistakeBoost * 2.5);

    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0 && this.mistakeActive <= 0) {
      // Иногда ИИ слегка "отвлекается" — плавно уводит траекторию,
      // но без резких рывков. Если этой утке сейчас "не везёт" (mistakeBoost),
      // такие моменты случаются чаще и держатся чуть дольше — выглядит как
      // обычная неровная гонка, а не подстроенная.
      if (Math.random() < 0.25 * wobbleFactor) {
        this.mistakeActive = (0.6 + Math.random() * 0.6) * (1 + mistakeBoost * 0.7);
      }
      this.mistakeTimer = Math.max(1.6, (5 + Math.random() * 7) - mistakeBoost * 4.5);
    }

    let targetX = Math.sin(duck.s * 0.01 * this.weaveSpeed + this.weavePhase) * this.weaveAmp;

    // Иногда целится в ближайший непойманный буст (плавно, не рывком)
    const nearBoost = this._findNearbyBoost(duck);
    if (nearBoost && Math.random() < this.personality.aggression * 0.012) {
      targetX = targetX * 0.3 + nearBoost.xOffset * 0.7;
    }

    if (this.mistakeActive > 0) {
      this.mistakeActive -= dt;
      targetX += Math.sin(duck.s * 0.02) * 45;
    }

    // Лёгкие столкновения между соседними утками — сглаженное, плавное
    // расталкивание вместо мгновенного скачка targetX.
    let pushGoal = 0;
    for (const other of allDucks) {
      if (other === duck || other.finished) continue;
      if (Math.abs(other.s - duck.s) < 20 && Math.abs(other.x - duck.x) < 24) {
        pushGoal += duck.x < other.x ? -14 : 14;
        if (Math.random() < 0.006 + mistakeBoost * 0.02) {
          duck.stun(0.15 + mistakeBoost * 0.15);
        }
      }
    }
    this.pushOffset += (pushGoal - this.pushOffset) * Math.min(1, dt * 3);
    targetX += this.pushOffset;

    duck.targetX = targetX;

    // Периодический самостоятельный буст-разгон (создаёт ощущение "живого" соперника)
    if (!duck._aiBoostCooldown || duck._aiBoostCooldown <= 0) {
      if (Math.random() < 0.003 * this.personality.aggression) {
        duck.applyBoost('turbo', this.cfg);
        duck._aiBoostCooldown = 6 + Math.random() * 6;
      }
    } else {
      duck._aiBoostCooldown -= dt;
    }
  }

  _findNearbyBoost(duck) {
    for (const b of this.track.boosts) {
      if (!b.taken && b.s > duck.s && b.s - duck.s < 220) return b;
    }
    return null;
  }
}

class DifficultyDirector {
  constructor(cfg, track) {
    this.cfg = cfg;
    this.track = track;
    this.dda = cfg.dda || {};
    this.enabled = this.dda.enabled !== false;

    const gapMin = this.dda.finishGapMin ?? 0.2;
    const gapMax = this.dda.finishGapMax ?? 2.0;
    this.finishGapTarget = gapMin + Math.random() * (gapMax - gapMin);

    // Небольшая случайная вариация точки старта "финального рывка", чтобы
    // разные заезды ощущались по-разному.
    const baseStart = this.dda.finalStretchStart ?? 0.80;
    this.finalStretchStart = Math.min(0.92, Math.max(0.6, baseStart + (Math.random() * 0.04 - 0.02)));

    this.assist = 0;        // 0..1, сглаженный текущий уровень помощи
    this.tookLead = false;  // однажды выйдя вперёд в финальном отрезке, слегка подстраховываем лидерство
    this.boostInjected = false;
  }

  update(dt, player, aiDucks) {
    if (!this.enabled) {
      this._resetNeutral(player, aiDucks);
      return;
    }
    if (player.finished) return;

    const aliveAI = aiDucks.filter((d) => !d.finished);
    const anyAIFinished = aiDucks.some((d) => d.finished);
    const leader = aliveAI.length ? aliveAI.reduce((a, b) => (b.s > a.s ? b : a)) : null;
    // gap > 0 значит соперник впереди игрока
    const gap = anyAIFinished ? 999 : (leader ? leader.s - player.s : -999);

    const progress = player.progressRatio;
    const inFinalStretch = progress >= this.finalStretchStart;

    // Базовый уровень помощи — пропорционален отставанию, работает всю гонку,
    // но мягко (максимум 0.5 от полной шкалы), чтобы не быть заметным раньше времени.
    const behindNorm = Math.max(0, Math.min(1, gap / 220));
    let assistTarget = behindNorm * 0.5;

    if (inFinalStretch) {
      const span = Math.max(0.001, 1 - this.finalStretchStart);
      const stretchT = Math.min(1, (progress - this.finalStretchStart) / span);
      if (gap > 0) {
        // Гарантия обгона: чем ближе к финишу и чем больше отставание,
        // тем решительнее (но всё ещё плавно) выравниваем разрыв.
        assistTarget = Math.max(assistTarget, 0.5 + stretchT * 0.5);
      }
      if (this.tookLead) {
        // Уже вышли вперёд в этом отрезке — держим небольшую подстраховку,
        // чтобы не потерять лидерство перед самой чертой.
        assistTarget = Math.max(assistTarget, 0.12);
      }
      // Один раз естественно "подкидываем" бустер прямо по курсу игрока —
      // выглядит как удачно расположенный буст, а не как читерство.
      if (!this.boostInjected && gap > 15 && stretchT > 0.1) {
        this._injectRescueBoost(player);
        this.boostInjected = true;
      }
    }

    if (gap <= 0) {
      if (inFinalStretch) this.tookLead = true;
      else assistTarget = 0; // лидируем и ещё не в финальном отрезке — ведём полностью честно
    }

    // Аварийный предохранитель у самой черты: если почти у финиша и всё ещё
    // позади — форсируем максимальную (но по-прежнему сглаженную) помощь.
    const nearFinishOverride = progress > 0.95 && gap > 0;
    if (nearFinishOverride) assistTarget = 1;

    const smoothRate = nearFinishOverride ? 5 : 1.5;
    this.assist += (assistTarget - this.assist) * Math.min(1, dt * smoothRate);

    // ---- Применяем к игроку ------------------------------------------
    player.assistSpeedMult = 1 + this.assist * (this.dda.maxSpeedBonus ?? 0.16);
    player.boostEfficiency = 1 + this.assist * (this.dda.maxBoostEfficiencyBonus ?? 0.35);
    player.corneringAssist = this.assist * (this.dda.maxCorneringAssist ?? 0.6);

    // ---- Применяем к соперникам ----------------------------------------
    // Сильнее всего затрагивает текущего лидера погони, остальных — слабее,
    // чтобы эффект оставался локальным и незаметным на общем фоне гонки.
    for (const duck of aiDucks) {
      if (duck.finished) {
        duck.handicapSpeedMult = 1;
        duck.mistakeBoost = 0;
        continue;
      }
      const isLeader = duck === leader;
      const local = this.assist * (isLeader ? 1 : 0.35);
      duck.handicapSpeedMult = 1 - local * (this.dda.maxAiHandicap ?? 0.14);
      duck.mistakeBoost = local;
    }
  }

  _resetNeutral(player, aiDucks) {
    player.assistSpeedMult = 1;
    player.boostEfficiency = 1;
    player.corneringAssist = 0;
    for (const duck of aiDucks) {
      duck.handicapSpeedMult = 1;
      duck.mistakeBoost = 0;
    }
  }

  /**
   * Естественно выглядящий "спасательный" буст: ищем непойманный буст чуть
   * впереди по курсу игрока и превращаем его в турбо, либо — если рядом
   * ничего нет — создаём новый прямо на полосе игрока (с небольшим случайным
   * смещением, чтобы за него всё же нужно было слегка довернуть).
   */
  _injectRescueBoost(player) {
    const aheadMin = player.s + 90;
    const aheadMax = player.s + 240;
    const existing = this.track.boosts.find((b) => !b.taken && b.s >= aheadMin && b.s <= aheadMax);
    if (existing) {
      existing.type = 'turbo';
      return;
    }
    this.track.boosts.push({
      id: `rescue_${Math.round(player.s)}`,
      s: player.s + 150 + Math.random() * 60,
      xOffset: player.x + (Math.random() * 30 - 15),
      type: 'turbo',
      taken: false,
    });
  }
}

window.AIController = AIController;
window.DifficultyDirector = DifficultyDirector;
