/**
 * InputController — управление для Duck Rush.
 *
 *  - ДЕСКТОП: ← / → (или A / D) — руль влево/вправо, ↑ (или W) — ускорение
 *    (временный буст скорости, пока клавиша зажата).
 *  - МОБИЛЬНЫЕ/ТАЧ: утка двигается прямо пальцем — тронул экран и ведёшь
 *    палец влево/вправо, утка следует за смещением пальца от точки касания.
 *    Отпустил — утка плавно возвращается к центру потока. Никакого
 *    видимого джойстика на экране нет: вся игровая область — это "стик".
 *
 * Наружу отдаётся steer в диапазоне [-1, 1] и accelerate (bool) —
 * держит ли игрок сейчас клавишу ускорения.
 */
class InputController {
  constructor({ dragSurface, dragSensitivityPx, keyboardRamp }) {
    this.dragSurface = dragSurface;
    this.dragSensitivityPx = dragSensitivityPx || 90; // px смещения пальца = полный поворот
    this.keyboardRamp = keyboardRamp || 3.2; // 1/сек — как быстро руль от клавиатуры нарастает/спадает

    this.steerFromDrag = 0;
    this.steerFromKeys = 0;      // сглаженное значение (то, что реально используется)
    this._keyTarget = 0;          // целевое значение от текущих нажатых клавиш (-1/0/1)
    this.dragging = false;
    this.activePointerId = null;
    this.dragStartX = 0;

    this.accelerate = false;

    this._keys = new Set();
    this._bind();
  }

  get steer() {
    const v = this.dragging ? this.steerFromDrag : (this.steerFromDrag || this.steerFromKeys);
    return Math.max(-1, Math.min(1, v));
  }

  /**
   * Плавно подводит клавиатурный руль к текущей цели (-1/0/1). Вызывается
   * каждый кадр из игрового цикла — так нажатие стрелки не даёт мгновенный
   * скачок утки в сторону, а плавно "раскручивает" поворот, как и отпускание.
   */
  update(dt) {
    if (this.steerFromKeys !== this._keyTarget) {
      const rate = this.keyboardRamp;
      const delta = this._keyTarget - this.steerFromKeys;
      const step = rate * dt;
      if (Math.abs(delta) <= step) this.steerFromKeys = this._keyTarget;
      else this.steerFromKeys += Math.sign(delta) * step;
    }
  }

  _bind() {
    this._onPointerDown = (e) => {
      // Не перехватываем нажатия на кнопки интерфейса (звук, закрыть и т.п.)
      if (e.target.closest('.dr-mute-btn, .dr-close-btn, .dr-results, .dr-countdown')) return;
      this.dragging = true;
      this.activePointerId = e.pointerId;
      this.dragStartX = e.clientX;
      this.steerFromDrag = 0;
      try { this.dragSurface.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    };
    this._onPointerMove = (e) => {
      if (!this.dragging || e.pointerId !== this.activePointerId) return;
      const dx = e.clientX - this.dragStartX;
      this.steerFromDrag = Math.max(-1, Math.min(1, dx / this.dragSensitivityPx));
    };
    this._onPointerEnd = (e) => {
      if (e.pointerId !== this.activePointerId) return;
      this.dragging = false;
      this.activePointerId = null;
      this.steerFromDrag = 0; // отпустили — утка плавно возвращается к центру потока
    };

    this._onKeyDown = (e) => {
      if (['a', 'A', 'ArrowLeft', 'd', 'D', 'ArrowRight'].includes(e.key)) {
        this._keys.add(e.key);
        this._recomputeKeys();
      }
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        this.accelerate = true;
      }
    };
    this._onKeyUp = (e) => {
      this._keys.delete(e.key);
      this._recomputeKeys();
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        this.accelerate = false;
      }
    };
    // Если окно теряет фокус — не даём клавише "залипнуть" в нажатом состоянии
    this._onBlur = () => {
      this._keys.clear();
      this._recomputeKeys();
      this.accelerate = false;
    };

    this.dragSurface.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerEnd);
    window.addEventListener('pointercancel', this._onPointerEnd);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  _recomputeKeys() {
    let v = 0;
    if (this._keys.has('a') || this._keys.has('A') || this._keys.has('ArrowLeft')) v -= 1;
    if (this._keys.has('d') || this._keys.has('D') || this._keys.has('ArrowRight')) v += 1;
    this._keyTarget = v;
  }

  destroy() {
    this.dragSurface.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerEnd);
    window.removeEventListener('pointercancel', this._onPointerEnd);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.dragging = false;
    this.steerFromDrag = 0;
    this.steerFromKeys = 0;
    this._keyTarget = 0;
    this.accelerate = false;
  }
}

window.InputController = InputController;
