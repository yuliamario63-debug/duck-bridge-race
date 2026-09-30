/**
 * UIManager — всё, что рисуется поверх canvas через обычный DOM
 * (HUD, счётчик, экран результатов). Держать текст в DOM, а не
 * рисовать его на canvas, даёт чёткий шрифт на любом DPI и упрощает
 * доступность/локализацию.
 */
class UIManager {
  constructor(root, cfg) {
    this.root = root;
    this.cfg = cfg;
    this.$ = (id) => root.querySelector('#' + id);

    this.positionEl = this.$('drPosition');
    this.positionTotalEl = this.root.querySelector('.dr-hud-sub');
    this.progressFill = this.$('drProgressFill');
    this.progressDuck = this.$('drProgressDuck');
    this.timerEl = this.$('drTimer');
    this.boostBanner = this.$('drBoostBanner');
    this.countdownEl = this.$('drCountdown');
    this.hintEl = this.$('drHint');
    this.resultsEl = this.$('drResults');
    this.resultsCard = this.$('drResultsCard');
    this.muteBtn = this.$('drMuteBtn');

    this._boostBannerTimeout = null;
  }

  setTotalRacers(n) {
    this.positionTotalEl.textContent = `/ ${n}`;
  }

  updateHUD({ position, progressRatio, elapsed }) {
    this.positionEl.textContent = position;
    const pct = Math.min(100, progressRatio * 100);
    this.progressFill.style.width = pct + '%';
    this.progressDuck.style.left = pct + '%';
    this.timerEl.textContent = elapsed.toFixed(1);
  }

  flashBoost(icon, label) {
    clearTimeout(this._boostBannerTimeout);
    this.boostBanner.textContent = `${icon} ${label}`;
    this.boostBanner.classList.remove('show');
    // force reflow to restart animation
    void this.boostBanner.offsetWidth;
    this.boostBanner.classList.add('show');
    this._boostBannerTimeout = setTimeout(() => this.boostBanner.classList.remove('show'), 1100);
  }

  hideHint() {
    this.hintEl.style.opacity = '0';
  }
  showHint() {
    this.hintEl.style.opacity = '1';
  }

  async runCountdown(seconds, onBeep) {
    this.countdownEl.classList.remove('hidden');
    for (let i = seconds; i >= 1; i--) {
      this.countdownEl.textContent = i;
      this.countdownEl.classList.remove('pulse');
      void this.countdownEl.offsetWidth;
      this.countdownEl.classList.add('pulse');
      if (onBeep) onBeep(i === 1);
      await this._wait(1000);
    }
    this.countdownEl.textContent = 'ВПЕРЁД!';
    this.countdownEl.classList.remove('pulse');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pulse');
    if (onBeep) onBeep(true);
    await this._wait(500);
    this.countdownEl.classList.add('hidden');
  }

  _wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

  setMuted(isEnabled) {
    this.muteBtn.textContent = isEnabled ? '🔊' : '🔇';
  }

  showResults({ won, position, promoCode, discountPercent, onPlayAgain, onApplyPromo }) {
    this.resultsEl.classList.remove('hidden');
    this.resultsCard.innerHTML = '';

    if (won) {
      this._spawnConfetti();
      this.resultsCard.innerHTML = `
        <div class="emoji">🎉</div>
        <h2>Поздравляем!</h2>
        <p>Вы выиграли гонку!<br/>Дарим вам промокод на скидку ${discountPercent}% на следующий заказ.</p>
        <div class="dr-promo-box"><small>Ваш промокод</small>${promoCode}</div>
        <div class="dr-results-actions">
          <button class="dr-btn-cta" id="drUsePromoBtn">Использовать скидку</button>
          <button class="dr-btn-ghost" id="drPlayAgainBtn">Играть снова</button>
        </div>
      `;
      this.$('drUsePromoBtn').addEventListener('click', () => onApplyPromo && onApplyPromo(promoCode));
    } else {
      this.resultsCard.innerHTML = `
        <div class="emoji">🦆</div>
        <h2>Почти получилось!</h2>
        <p>Вы финишировали ${position}-м.<br/>Попробуйте ещё раз — удача любит настойчивых путешественников 🦆</p>
        <div class="dr-results-actions">
          <button class="dr-btn-cta" id="drPlayAgainBtn">Играть снова</button>
        </div>
      `;
    }
    this.$('drPlayAgainBtn').addEventListener('click', () => onPlayAgain && onPlayAgain());
  }

  hideResults() {
    this.resultsEl.classList.add('hidden');
    this.resultsEl.querySelectorAll('.dr-confetti-piece').forEach((n) => n.remove());
  }

  _spawnConfetti() {
    const colors = [this.cfg.colors.sunYellow, this.cfg.colors.coral, this.cfg.colors.waterMid, '#FFFFFF'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'dr-confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
      piece.style.animationDelay = Math.random() * 0.6 + 's';
      this.resultsEl.appendChild(piece);
    }
  }
}

window.UIManager = UIManager;
