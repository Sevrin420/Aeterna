// The emoji ring.
//
// Fifty emoji laid out along a shallow arc — Saturn's ring, not a dial. It is
// driven by the console's own controls: the d-pad turns it, A sends the one at
// the front, B closes it. There is no swipe and no tap-to-pick, deliberately.
// The game is played with a thumb on a d-pad, and a second, different way to
// choose things is one the player has to learn for this screen alone.
//
// LAYOUT. Position comes from a face's DISTANCE IN PLACES from the front, not
// from the sine of its angle. That distinction is the whole thing: sin() bunches
// faces hard as they approach the edges, so a fifty-item ring drawn that way
// piles most of them on top of each other in two clumps and the ring reads as a
// smear. Spacing by place puts a real, controlled gap between neighbours, and
// widens it slightly further out so the arc still reads as curving away.
//
// The FRONT FACE DOES NOT SCALE. It is the thing being chosen, so it holds one
// size and one colour no matter where the ring is in its travel; everything
// else shrinks and fades with distance. A front face that breathed as the ring
// settled would make the selection look unstable at exactly the moment it has
// to look certain.

// The fifty most-used emoji, in rough order of use. Kept as one flat list so
// the ring is a ring — categories would want dividers and this has no room.
export const EMOJIS = [
  '😂', '❤️', '🤣', '👍', '😭', '🙏', '😘', '🥰', '😍', '😊',
  '🎉', '😁', '💕', '🥺', '😅', '🔥', '☺️', '🤦', '♥️', '🤷',
  '🙄', '😆', '🤗', '😉', '🎂', '🤔', '👏', '🙂', '😳', '🥳',
  '😎', '👌', '💜', '😔', '💪', '✨', '💖', '👀', '😋', '😏',
  '😴', '💀', '👋', '💯', '🙌', '🤝', '😢', '🖤', '⚡', '🩸',
];

// How many places either side of the front are drawn. Beyond this a face is
// hidden outright rather than drawn at 2% opacity: fifty ghosts along the arc
// is the clutter this layout exists to remove.
const VISIBLE = 5;

export class EmojiWheel {
  /**
   * @param {HTMLElement} root  the overlay element to build into
   * @param {(emoji: string) => void} onPick
   */
  constructor(root, onPick) {
    this.root = root;
    this.onPick = onPick || (() => {});
    this.index = 0;      // which emoji is at the front
    this.offset = 0;     // how far the ring still has to travel, in places
    this.open = false;
    this._raf = null;

    this.ring = document.createElement('div');
    this.ring.className = 'ew-ring';
    this.faces = EMOJIS.map((e) => {
      const el = document.createElement('div');   // not a button: nothing is clickable
      el.className = 'ew-face';
      el.textContent = e;
      this.ring.appendChild(el);
      return el;
    });

    this.hint = document.createElement('p');
    this.hint.className = 'ew-hint';
    this.hint.textContent = '◀ ▶ turn · A send · B close';

    root.append(this.ring, this.hint);
    this._layout();
  }

  /**
   * Driven from the game loop while the ring is open, so it uses the same
   * d-pad and the same A button as everything else the player does.
   * @returns true when the ring consumed the frame's input
   */
  handleInput(input) {
    if (!this.open) return false;
    const d = input.consumeDir ? input.consumeDir() : null;
    if (d === 'left') this.step(-1);
    else if (d === 'right') this.step(1);
    if (input.consumeAPress()) this._send(EMOJIS[this.index]);
    else if (input.consumeBPress()) this.hide();
    return true;
  }

  step(dir) {
    this.index = (this.index + dir + EMOJIS.length) % EMOJIS.length;
    // The ring is mid-travel toward the new front; offset is what is left to
    // cover, and it animates to zero. Held on the d-pad this accumulates
    // rather than restarting, so a fast scroll stays smooth instead of
    // snapping on every press.
    this.offset -= dir;
    this._run();
  }

  _send(e) {
    this.onPick(e);
    this.hide();
  }

  _run() {
    if (this._raf) return;
    const tick = () => {
      this.offset *= 0.72;
      if (Math.abs(this.offset) < 0.002) {
        this.offset = 0;
        this._layout();
        this._raf = null;
        return;
      }
      this._layout();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _layout() {
    const n = EMOJIS.length;
    for (let i = 0; i < n; i++) {
      // Shortest signed distance in PLACES from the front, so the ring wraps
      // without the far end of the list flying across the screen.
      let k = i - this.index;
      if (k > n / 2) k -= n;
      if (k < -n / 2) k += n;
      k += this.offset;                       // mid-travel

      const el = this.faces[i];
      const ak = Math.abs(k);
      if (ak > VISIBLE + 0.6) { el.style.display = 'none'; continue; }
      el.style.display = '';

      // Gaps widen with distance, so neighbours never touch and the arc still
      // reads as turning away rather than as a flat row.
      const x = Math.sign(k) * (11.5 * ak + 1.35 * ak * ak);
      const y = ak * ak * 0.55;               // a shallow droop at the ends
      const t = Math.min(1, ak / VISIBLE);    // 0 at the front, 1 at the edge

      // The front holds ONE size. Everything else is smaller with distance.
      const scale = ak < 0.5 ? 1 : 0.74 - t * 0.30;
      el.style.left = `${50 + x}%`;
      el.style.top = `${46 + y}%`;
      el.style.transform = `translate(-50%,-50%) scale(${scale})`;
      el.style.opacity = `${1 - t * 0.72}`;
      el.style.filter = `saturate(${1 - t * 0.75}) blur(${t * 0.7}px)`;
      el.style.zIndex = String(100 - Math.round(ak * 10));
      el.classList.toggle('ew-front', i === this.index);
    }
  }

  show() {
    this.open = true;
    this.offset = 0;
    this.root.hidden = false;
    this._layout();
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  toggle() { this.open ? this.hide() : this.show(); }
}
