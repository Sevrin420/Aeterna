// The two renames, in one place: what the abbey is called, and what its cast
// says while it works.
//
// Both ride a flag with a URL override, in the same shape as BIRDS in
// pixelchar.js — flip the constant to roll back in code, or append the query
// param to look at a DEPLOYED build the other way without redeploying:
//
//   ?oldName=1    the old name, "Vita Aeterna", everywhere it is shown
//   ?oldChant=1   the old Latin mantra at all three altars
//
// The bird cast itself is NOT switched here: that is BIRDS in pixelchar.js and
// its own ?birds= override, which stays the single switch for the sprites and
// for the words that describe them.

const q = (() => {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
})();

export const NEW_NAME = q.get('oldName') !== '1';    // <-- false restores "Vita Aeterna"
export const NEW_CHANT = q.get('oldChant') !== '1';  // <-- false restores the Latin

// The abbey's name, as the player ever sees it written, and the browser tab:
// the name and its motto, which is how the tab has always read.
export const GAME_NAME = NEW_NAME ? 'Throbbin Abbey' : 'Vita Aeterna';
export const PAGE_TITLE = NEW_NAME ? 'Throbbin Abbey — Eternal Life' : 'Aeterna — Vita Aeterna';

// The mantra every rite is performed to. ONE definition — the shrine, the fire
// vigil and the courtyard duties all read this, so the whole day has one voice
// and a change to it cannot land at two altars out of three.
export const CHANT_PAIR = NEW_CHANT
  ? ['Eternal Throb', 'Eternal Life']
  : ['Sanguis aeternus', 'Vita aeterna'];
