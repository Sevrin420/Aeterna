// Everything the player reads, in one place.
//
// The Doctrine and the mint rite used to live in HTML overlays floating above
// the console; the prayers and the instructions did not exist as readable text
// at all — they were one-line toasts that scrolled away. Now all of it is here
// and all of it goes through the dialogue box, which means the writing can be
// edited in one file without touching markup, layout or scene code.
//
// Each entry is an array of pages, written long enough to fill the frame — a
// near-fullscreen box holding three lines reads as broken. The box paginates
// anything that overflows anyway, so the breaks here are editorial: a page
// break is a beat.

export const LORE = {
  doctrine: [
    {
      speaker: 'The Doctrine',
      text: 'Vita Aeterna is a death-cult.\n\n'
        + 'Spirits gather in the sanctuary beneath the inverted cross to earn '
        + 'Devotion. Devotion is the only thing the abbey counts, and it counts '
        + 'everything.\n\n'
        + 'Kneel in prayer. Light the black candles. Chant to the skulls. Carry '
        + 'a gift to the Abbot.',
    },
    {
      text: 'Four rites, every day.\n\n'
        + 'Keep them unbroken and your streak multiplies every Devotion you earn '
        + 'thereafter. Miss a day and the streak falls to nothing — though the '
        + 'confessional in the transept will restore it once, for a price.\n\n'
        + 'The abbey does not forgive. It keeps accounts.',
    },
    {
      text: 'Two stairways descend from the nave.\n\n'
        + 'The ossuary holds the soul altar, where the season takes what it is '
        + 'owed. The ritual chamber holds the mancala table, where lots are cast '
        + 'against whoever else has come down into the dark.\n\n'
        + 'Both are open to you. Neither is safe.',
    },
    {
      text: 'Bind a Cultist to claim your name, your face and your standing in '
        + 'the order.\n\n'
        + 'Until then you wander the abbey as a spirit — seen by no one, counted '
        + 'all the same. Nothing you earn as a spirit is lost when you take a '
        + 'body.',
    },
  ],

  mint: [
    {
      speaker: 'The Binding',
      text: 'Cultist NFTs are not yet open for minting.\n\n'
        + 'When the rite begins, you will mint here: a Cultist bound to your '
        + 'wallet, with a name the order will use, a face it will recognise, and '
        + 'a place in the standing.',
    },
    {
      text: 'Until then, pass north through the arch as a wandering spirit.\n\n'
        + 'Every rite you keep and every gift you carry is recorded against you '
        + 'now, and it follows you into a body when you take one.\n\n'
        + 'Nothing is lost by starting early.',
    },
  ],


  // Read at each duty station, before the rite is performed.
  stations: {
    pray: {
      speaker: 'The Altar',
      // Six repetitions, and the box holds for a full ten seconds — see
      // PRAYER_HOLD in courtyard.js. The rite is the waiting.
      //
      // Short form deliberately. At 12px the box fits 22 characters to a line
      // and seven lines to a page, so the two-part mantra would wrap to twelve
      // lines and split the prayer across two pages — which would need a page
      // turn in the middle of a rite that is supposed to be one held breath.
      // The full "Sanguis Aeternus, Vita Aeterna" still belongs to the chant
      // at the skulls, where it is spoken rather than read.
      text: Array(6).fill('Sanguis aeternus.').join('\n'),
    },
    candles: {
      speaker: 'The Brazier',
      text: 'Cold iron, and the smell of the last burning still in it.',
    },
    garden: {
      speaker: 'The Skulls',
      text: 'Five hundred of them, set into the wall in rows, each one facing '
        + 'out.\n\nChant, and they chant with you.',
    },
    // Three lines for one man, chosen by what is in your hands. None of them
    // tells you where the switches are or what he will do with one — that is
    // for the skull chamber and the first blow to explain.
    guru: {
      speaker: 'The Abbot',
      text: 'He does not look up. He never looks up.\n\n'
        + 'His hands are open, and they are waiting.',
    },
    // shown when you arrive carrying a switch
    scourge: {
      speaker: 'The Abbot',
      text: '"Kneel."\n\nHe takes it from you without a word.',
    },
    // shown when the fifth blow has landed
    scourged: {
      speaker: 'The Abbot',
      text: 'The pain purifies. What is left is counted.\n\n'
        + '"Again tomorrow."',
    },
    scourgedAlready: {
      speaker: 'The Abbot',
      text: 'He looks at the switch, and then at your back.\n\n'
        + '"You have bled enough today."',
    },
    confession: {
      speaker: 'The Confessor',
      text: 'A monk in white waits behind the lattice. He does not give his '
        + 'name.\n\n'
        + '"A broken streak can be mended here. Once."\n\n'
        + 'The abbey does not forgive freely. It only keeps accounts, and this '
        + 'is a line in one.',
    },
    'soul-altar': {
      speaker: 'The Soul Altar',
      text: 'Below the ossuary, in the dark, the altar waits for what the season '
        + 'is owed.',
    },
    nursery: {
      speaker: 'The Cradle',
      text: 'Something is kept here that the order does not name aloud.',
    },
    mancala: {
      speaker: 'The Mancala Table',
      text: 'Forty-eight stones and two rows of pits, worn smooth by hands that '
        + 'are no longer attached to anyone.\n\n'
        + 'Sit, and cast lots against whoever else is fool enough to sit.',
    },
    gate: {
      speaker: 'The Gate',
      text: 'Leave now and your Devotion is secured.\n\n'
        + 'The abbey will still be here.',
    },
    leaderboard: {
      speaker: 'The Devout',
      text: 'The names of those who have given most, cut into the wall in order.',
    },
    bulletin: {
      speaker: 'The Bulletin',
      text: 'A board of dark wood by the nave, where the abbey posts what the '
        + 'season is doing to you.',
    },
  },
};

// The bulletin reads live season data, so it is built rather than stored.
export function bulletinPages(s) {
  if (!s) {
    return [{ speaker: 'The Bulletin', text: 'The board is water-stained and unreadable.' }];
  }
  if (s.inBreak) {
    return [{
      speaker: 'The Bulletin',
      text: `Season ${s.season} is between cycles.\n\nThe abbey rests. The counting has stopped.`,
    }];
  }
  if (s.isFinalCommunion) {
    return [{
      speaker: 'The Bulletin',
      text: `Season ${s.season}, Day ${s.day}.\n\n`
        + 'Final Communion is upon us. What is owed is collected today.',
    }];
  }
  return [{
    speaker: 'The Bulletin',
    text: `Season ${s.season}, Day ${s.day} of 56.\n\n`
      + `${s.daysUntilCommunion} days until Final Communion.`,
  }];
}
