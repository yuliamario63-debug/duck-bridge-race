/**
 * AudioManager — все звуки синтезируются через Web Audio API.
 * Так игра не зависит от внешних .mp3/.ogg файлов и весит меньше.
 * Если хотите заменить на настоящие сэмплы — просто подгрузите
 * AudioBuffer в конструкторе и используйте вместо синтеза.
 */
class AudioManager {
  constructor(enabled) {
    this.enabled = enabled;
    this.ctx = null;
    this.musicNodes = [];
    this.musicTimer = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(value) {
    this.enabled = value;
    if (!value) this.stopMusic();
    else this.startMusic();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  _tone(freq, dur, type = 'sine', gainStart = 0.2, when = 0) {
    if (!this.enabled) return;
    const ctx = this._ensureCtx();
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(gainStart, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noiseBurst(dur, gainStart = 0.15, filterFreq = 1200) {
    if (!this.enabled) return;
    const ctx = this._ensureCtx();
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainStart, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  splash() { this._noiseBurst(0.25, 0.12, 1800); }

  boost() {
    this._tone(440, 0.12, 'sawtooth', 0.15);
    this._tone(880, 0.18, 'sawtooth', 0.12, 0.06);
  }

  quack() {
    if (!this.enabled) return;
    const ctx = this._ensureCtx();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
    gain.gain.setValueAtTime(0.1, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  bump() { this._noiseBurst(0.12, 0.18, 400); }

  countdownBeep(high = false) { this._tone(high ? 880 : 520, 0.18, 'sine', 0.2); }

  applause() {
    if (!this.enabled) return;
    for (let i = 0; i < 18; i++) {
      setTimeout(() => this._noiseBurst(0.06, 0.08, 3000 + Math.random() * 2000), i * 45);
    }
    this._tone(660, 0.3, 'triangle', 0.15, 0.1);
    this._tone(880, 0.3, 'triangle', 0.15, 0.25);
  }

  startMusic() {
    if (!this.enabled || this.musicTimer) return;
    const ctx = this._ensureCtx();
    const notes = [523, 659, 784, 659, 587, 698, 880, 698];
    let i = 0;
    const step = () => {
      if (!this.enabled) return;
      this._tone(notes[i % notes.length], 0.22, 'triangle', 0.045);
      i++;
      this.musicTimer = setTimeout(step, 260);
    };
    step();
  }

  stopMusic() {
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }
}

window.AudioManager = AudioManager;
