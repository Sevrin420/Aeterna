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

import { GOLD, BLOOD, SOUL, BONE, IRON } from './palette.js';

export const LORE = {
  doctrine: [
    {
      speaker: 'The Doctrine',
      text: 'Vita Aeterna is a death-cult.\n\n'
        + 'Spirits gather in the sanctuary beneath the inverted cross to earn '
        + 'Devotion. Devotion is the only thing the abbey counts, and it counts '
        + 'everything.',
    },
    {
      text: 'The abbey sets duties, and it sets them fresh every day.\n\n'
        + 'Walk the halls. Where something can be done, a gold mark appears '
        + 'over your head. That is the only invitation you will get, and it is '
        + 'the only one you need.',
    },
    {
      text: 'Keep the day\'s duties and your streak grows.\n\n'
        + 'A streak multiplies what every duty pays — the longer you hold it, '
        + 'the more each act is worth. Miss a day and it falls to nothing.\n\n'
        + 'The confessor in the west arm will mend a broken streak. Once, and '
        + 'not for free.',
    },
    {
      speaker: 'Where Mint Goes',
      text: '🩸 Every mint is split two ways.',
      chart: {
        slices: [
          { label: 'Treasury', sub: 'for the players', pct: 90, color: BLOOD.b, emoji: '🩸' },
          { label: 'Team', sub: 'keeps it running', pct: 10, color: IRON.l, emoji: '👤' },
        ],
      },
    },
    {
      speaker: 'The Treasury',
      text: '⚖️ Two pots, same size.',
      chart: {
        slices: [
          { label: 'Season 1', sub: 'paid to winners', pct: 50, color: GOLD.b, emoji: '🏆' },
          { label: 'Bloodline', sub: 'Aeterna, long term', pct: 50, color: SOUL.b, emoji: '🧬' },
        ],
      },
    },
    {
      speaker: 'Season 1 Winners',
      text: '💀 Ranked by Devotion.',
      chart: {
        slices: [
          { label: 'Top half', sub: 'split the pot', pct: 50, color: GOLD.b, emoji: '🏆' },
          { label: 'Bottom half', sub: 'get nothing', pct: 50, color: '#2a2731', emoji: '💀' },
        ],
      },
    },
    {
      text: 'Two stairways descend from the transept.\n\n'
        + 'West, a warren of shuttered rooms. East, a chamber walled with '
        + 'skulls, where something very old is lying on the floor.\n\n'
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
    candles: {
      speaker: 'The Brazier',
      text: 'Cold iron, and the smell of the last burning still in it.',
    },
    // Four lines for one man, chosen by what is in your hands and what you
    // have already done today. None of them names a duty, counts one, or hints
    // that anything must come before anything else — the order is a thing the
    // abbey enforces and never explains.
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
    // Shown when he will not take the switch yet. Deliberately says nothing
    // about why: it named the cold braziers before, which was an instruction
    // wearing a robe.
    scourgeTooSoon: {
      speaker: 'The Abbot',
      text: 'He closes his hands.\n\n'
        + 'He does not look up, and he does not explain.',
    },
    scourgedAlready: {
      speaker: 'The Abbot',
      text: 'He looks at the switch, and then at your back.\n\n'
        + '"You have bled enough today."',
    },
    confession: {
      speaker: 'The Confessor',
      text: '"You have broken something."\n\n'
        + '"I can mend it. Once, and once only, and not for nothing — the '
        + 'abbey does not forgive, it keeps accounts, and this will be a line '
        + 'in one."\n\n'
        + '"Kneel, or go."',
    },
    mancala: {
      speaker: 'The Mancala Table',
      text: 'Forty-eight stones and two rows of pits, worn smooth by hands that '
        + 'are no longer attached to anyone.\n\n'
        + 'Sit, and cast lots against whoever else is fool enough to sit.',
    },
    // One page, and it ends in a question — so it has to say what lying down
    // costs in the space of a few lines. The old second paragraph (the abbey
    // waking you in another cell) is flavour the player learns by waking there.
    bed: {
      speaker: 'The Cot',
      // Five lines is all one page holds once the speaker and the Yes/No row
      // have taken their share — three of prose, a blank, and the question.
      // Anything longer silently spills to a second page, which is the thing
      // this entry exists to avoid, so keep the prose under about 60 chars.
      text: 'A plank frame, a thin blanket. The day is closed and counted.\n\n'
        + 'Sleep now?',
    },
  },
};

