// The emoji ring.
//
// Fifty emoji on an ellipse seen nearly edge-on — Saturn's ring, not a dial.
// The one at the front is full size and full colour; the further round the ring
// a face travels the smaller, fainter and further back it sits, so the ring
// reads as a solid object turning rather than a list that happens to curve.
//
// Depth is one number. `d` runs 1 at the front to 0 at the back, and scale,
// opacity, blur and stacking order are all read off it, which is what keeps
// the illusion consistent: nothing can be big and faint, or sharp and behind.

// The fifty most-used emoji, in rough order of use. Kept as one flat list so
// the ring is a ring — categories would want dividers and this has no room.
export const EMOJIS = [
  '😂', '❤️', '🤣', '👍', '😭', '🙏', '😘', '🥰', '😍', '😊',
  '🎉', '😁', '💕', '🥺', '😅', '🔥', '☺️', '🤦', '♥️', '🤷',
  '🙄', '😆', '🤗', '😉', '🎂', '🤔', '👏', '🙂', '😳', '🥳',
  '😎', '👌', '💜', '😔', '💪', '✨', '💖', '👀', '😋', '😏',
  '😴', '💀', '👋', '💯', '🙌', '🤝', '😢', '🖤', '⚡', '🩸',
];

const TAU = Math.PI * 2;

export class EmojiWheel {
  /**
   * @param {HTMLElement} root  the overlay element to build into
   * @param {(emoji: string) => void} onPick
   */
  constructor(root, onPick) {
    this.root = root;
    this.onPick = onPick || (() => {});
    this.angle = 0;            // radians; 0 puts EMOJIS[0] at the front
    this.target = 0;
    this.open = false;
    this._raf = null;

    this.ring = document.createElement('div');
    this.ring.className = 'ew-ring';
    this.faces = EMOJIS.map((e, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ew-face';
      el.textContent = e;
      el.setAttribute('aria-label', `emoji ${e}`);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        // Tapping the face already at the front sends it; tapping any other
        // brings it round. One gesture, and it cannot fire the wrong emoji
        // because the front is the only one that ever sends.
        if (this._frontIndex() === i) this._send(e);
        else this.spinTo(i);
      });
      this.ring.appendChild(el);
      return el;
    });

    this.hint = document.createElement('p');
    this.hint.className = 'ew-hint';
    this.hint.textContent = 'drag to turn · tap the front to send';

    root.append(this.ring, this.hint);
    root.addEventListener('click', () => this.hide());   // tapping off closes

    this._bindDrag();
    this._layout();
  }

  _frontIndex() {
    const step = TAU / EMOJIS.length;
    return ((Math.round(-this.angle / step) % EMOJIS.length) + EMOJIS.length) % EMOJIS.length;
  }

  _send(e) {
    this.onPick(e);
    this.hide();
  }

  spinTo(i) {
    const step = TAU / EMOJIS.length;
    // Travel the SHORT way round. Without this, picking index 49 from index 0
    // spins the whole ring backwards through forty-eight faces.
    let want = -i * step;
    while (want - this.target > Math.PI) want -= TAU;
    while (this.target - want > Math.PI) want += TAU;
    this.target = want;
    this._run();
  }

  _bindDrag() {
    let down = false, lastX = 0, moved = 0;
    const step = TAU / EMOJIS.length;

    const start = (x) => { down = true; lastX = x; moved = 0; };
    const move = (x) => {
      if (!down) return;
      const dx = x - lastX;
      lastX = x;
      moved += Math.abs(dx);
      // A drag turns the ring directly rather than flinging it: this is a
      // fifty-item ring on a small screen, and inertia makes it impossible to
      // land on a chosen face.
      this.angle += dx * 0.012;
      this.target = this.angle;
      this._layout();
    };
    const end = () => {
      if (!down) return;
      down = false;
      if (moved < 4) return;                    // a tap, not a drag
      this.target = Math.round(this.angle / step) * step;   // settle onto a face
      this._run();
    };

    this.ring.addEventListener('pointerdown', (e) => { e.stopPropagation(); start(e.clientX); });
    window.addEventListener('pointermove', (e) => move(e.clientX));
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.spinTo((this._frontIndex() + (e.deltaY > 0 ? 1 : -1) + EMOJIS.length) % EMOJIS.length);
    }, { passive: false });
  }

  _run() {
    if (this._raf) return;
    const tick = () => {
      const d = this.target - this.angle;
      if (Math.abs(d) < 0.0009) {
        this.angle = this.target;
        this._layout();
        this._raf = null;
        return;
      }
      this.angle += d * 0.22;
      this._layout();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _layout() {
    const n = EMOJIS.length;
    const step = TAU / n;
    // Which face counts as "the front" is the same answer the tap handler
    // uses, not a threshold on a float. Deriving it from depth meant the class
    // flickered off mid-settle — the ring looked right and the front was
    // briefly nothing, which is exactly when a player taps it.
    const front = this._frontIndex();
    for (let i = 0; i < n; i++) {
      const a = this.angle + i * step;
      // Mostly horizontal: the ring is wide and shallow, so the faces sweep
      // side to side and only bob a little as they come round.
      const x = Math.sin(a) * 46;        // % of the ring's width
      const y = Math.cos(a) * 7;         // % of its height — the shallow part
      const d = (Math.cos(a) + 1) / 2;   // 1 at the front, 0 at the back

      const el = this.faces[i];
      el.style.left = `${50 + x}%`;
      el.style.top = `${52 + y}%`;
      el.style.transform = `translate(-50%,-50%) scale(${0.40 + d * 1.05})`;
      el.style.opacity = `${0.14 + d * 0.86}`;
      // Only the front face is fully saturated; the rest wash out as they go
      // back, which is what stops fifty emoji reading as noise.
      el.style.filter = `saturate(${0.25 + d * 0.75}) blur(${(1 - d) * 0.9}px)`;
      el.style.zIndex = String(Math.round(d * 100));
      el.classList.toggle('ew-front', i === front);
    }
  }

  show() {
    this.open = true;
    this.root.hidden = false;
    this._layout();
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  toggle() { this.open ? this.hide() : this.show(); }
}
