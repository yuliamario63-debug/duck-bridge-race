/**
 * Track — процедурно генерируемая извилистая водная горка.
 * Трасса описана в системе "прогресс вдоль пути" (s, 0..length)
 * + "боковое смещение" (x, симметрично от центра). Такое
 * представление удобно для гонки "вид сверху со скроллом вперёд"
 * и не требует полноценной 2D-физики столкновений со стенками.
 */
class Track {
  constructor(config) {
    this.cfg = config;
    this.length = config.trackLength;
    this.baseWidth = 220;

    // Набор синусоид разной частоты/амплитуды даёт извилистую,
    // но детерминированную (одинаковую для игрока и всех ИИ) трассу.
    this.curveWaves = [
      { freq: 0.0011, amp: 95, phase: 0.4 },
      { freq: 0.0032, amp: 40, phase: 2.1 },
      { freq: 0.0007, amp: 60, phase: 5.0 },
    ];

    this.widthWaves = [
      { freq: 0.0015, amp: 45, phase: 1.2 },
    ];

    // Зоны течения: участки с разной скоростью потока воды.
    this.currentZones = this._generateCurrentZones();

    // Трамплины (дают вертикальный "прыжок"/визуальный эффект и краткий буст)
    this.ramps = this._generateRamps();

    // Водовороты (замедляют и слегка затягивают утку к центру)
    this.whirlpools = this._generateWhirlpools();

    // Бонусы на трассе
    this.boosts = this._generateBoosts();

    // Финишная линия
    this.finishS = this.length - 40;
  }

  // Центр трассы (боковой сдвиг всего "русла") в точке прогресса s
  centerAt(s) {
    let c = 0;
    for (const w of this.curveWaves) {
      c += Math.sin(s * w.freq + w.phase) * w.amp;
    }
    return c;
  }

  // Кривизна (производная центра) — используется для наклона утки на поворотах
  curvatureAt(s) {
    let d = 0;
    for (const w of this.curveWaves) {
      d += Math.cos(s * w.freq + w.phase) * w.amp * w.freq;
    }
    return d;
  }

  widthAt(s) {
    let w = this.baseWidth;
    for (const wave of this.widthWaves) {
      w += Math.sin(s * wave.freq + wave.phase) * wave.amp;
    }
    return Math.max(140, w);
  }

  // Множитель скорости течения в этой точке трассы (1 = обычный)
  currentSpeedAt(s) {
    for (const z of this.currentZones) {
      if (s >= z.start && s <= z.end) return z.mult;
    }
    return 1;
  }

  _generateCurrentZones() {
    const zones = [];
    let s = 300;
    let seed = 7;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    while (s < this.length - 300) {
      const len = 260 + rand() * 240;
      const mult = 0.75 + rand() * 0.9; // 0.75x .. 1.65x
      zones.push({ start: s, end: s + len, mult });
      s += len + 120 + rand() * 200;
    }
    return zones;
  }

  _generateRamps() {
    const ramps = [];
    let s = 600;
    while (s < this.length - 400) {
      ramps.push({ s, width: 60 });
      s += 700 + Math.random() * 500;
    }
    return ramps;
  }

  _generateWhirlpools() {
    const pools = [];
    let s = 900;
    while (s < this.length - 500) {
      const offset = (Math.random() - 0.5) * 2;
      pools.push({ s, xOffset: offset, radius: 55 });
      s += 900 + Math.random() * 700;
    }
    return pools;
  }

  _generateBoosts() {
    const types = Object.keys(this.cfg.boosts);
    const boosts = [];
    let s = 260;
    while (s < this.length - 200) {
      const type = types[Math.floor(Math.random() * types.length)];
      // немного разброса по бокам, но в пределах ширины русла
      const w = this.widthAt(s);
      const xOffset = (Math.random() - 0.5) * (w * 0.7);
      boosts.push({ id: `b_${boosts.length}`, s, xOffset, type, taken: false });
      s += this.cfg.boostSpawnEvery * (0.6 + Math.random() * 0.8);
    }
    return boosts;
  }

  resetBoosts() {
    this.boosts.forEach(b => (b.taken = false));
  }
}

window.Track = Track;
