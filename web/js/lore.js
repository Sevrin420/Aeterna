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

import { GOLD, BLOOD } from './palette.js';
// The cast's own switch, not a second one: when BIRDS is false the sprites are
// people again, and so are the few lines below that name a body part. One flag
// moves the pictures and the words together.
import { BIRDS } from './pixelchar.js';

const HANDS = BIRDS ? 'claws' : 'hands';

export const LORE = {
  // The Doctrine tells the player what the game IS and what to do today, and
  // then how the abbey pays for it. It used to open on the creed — the right
  // first page for a cult and the wrong one for someone who has just walked in
  // and wants to know which way to walk — and that page is now gone entirely
  // rather than merely demoted.
  //
  // Each page here is kept short on purpose. The box paginates anything that
  // overflows, so a page written long silently becomes two and the numbering
  // of the duties drifts away from the pages describing them — the headings
  // below only line up with their bodies while every entry fits its frame.
  doctrine: [
    {
      speaker: 'You have joined a cult',
      text: '3 daily tasks you must complete.',
    },
    {
      // The three duties are a MENU rather than three pages of their own. As
      // pages they sat between the reader and everything after them — four
      // turns to get past duties they may already know — and someone who only
      // wanted the second had to walk through the first. The list is opened
      // with A, read in place, and closed with B, so the docs never leave
      // this page to explain a duty.
      speaker: 'The Daily Three',
      text: 'Taken IN ORDER:',
      menu: {
        items: [
          {
            label: 'I. Light the Brazier',
            text: 'The north corridor.\n\n'
              + 'Lay wood in a brazier, then fetch a torch and bring it to the wood.',
          },
          {
            label: 'II. Purifying Pain',
            text: 'The north corridor, behind the Abbot.\n\n'
              + 'A switch lies there. Take it up and put it into his hands.',
          },
          {
            label: 'III. Holy Ritual',
            text: 'Down the eastern steps.\n\n'
              + 'Stand on the blood red tile. The shrine does the rest.',
          },
          // Not a duty: the way OUT of the list. It carries no text, so it
          // leaves for the page named by `goto` instead of opening in place.
          { label: 'Continue', goto: 'sleep' },
        ],
      },
    },
    {
      // Named, so the duties menu can send the reader here by id.
      id: 'sleep',
      speaker: 'Sleep',
      text: 'With all three done, return to the bed chambers and sleep.\n\n'
        + 'The day is closed, counted, and saved.',
    },
    {
      // Opens on the streak and on the way to mend one, which is what a reader
      // arrives at this page wanting. What the abbey does with the gold mark
      // over your head was the page before it and is gone.
      speaker: 'The Streak',
      text: 'Keep all three daily and the streak grows.\n\n'
        + 'Miss a day and it is gone. The Confessor mends it, for a price.',
    },
    {
      // Straight after The Streak, and deliberately the shortest page in the
      // docs. That page explains the mechanism; this one, while it is still in
      // front of the reader, says what the mechanism is FOR. It is the line
      // they should still have in their head after forgetting the rest, so it
      // sits on the streak rather than at the end behind the mint chart.
      speaker: 'Why It Matters',
      text: 'Longer Streaks\n= Higher Devotion\n\nHigher Devotion\n= Higher Payout',
    },
    {
      // The colours are the ones these two already had elsewhere in the docs —
      // gold and the trophy for what is paid out, blood for the treasury — so
      // the wedges still mean what they used to before the split was redrawn.
      speaker: 'Where Mint Goes',
      text: '',
      chart: {
        slices: [
          { label: 'Winners', pct: 80, color: GOLD.b, emoji: '\ud83c\udfc6' },
          { label: 'Treasury', pct: 20, color: BLOOD.b, emoji: '\ud83e\ude78' },
        ],
      },
    },
  ],

  // Why PLAY would not open. There is no wandering the abbey unbound any more —
  // either you are counted or you are not in — so the refusal has to say what
  // is missing and what to press, or it is just a locked door.
  blocked: {
    wallet: {
      speaker: 'The Door is Shut',
      text: 'No wallet is bound.\n\nPress WALLET to connect, then take up a Bloodline.',
    },
    // NOT a blocked state — the doors are open. Shown once on the way in, so
    // nobody performs three duties before finding out they paid for nothing.
    notBegun: {
      speaker: 'The Abbey Waits',
      text: 'The doors are open.\n\nThe run has not begun. Nothing is counted yet.\n\nRaise your line. When it starts, it starts for everyone at once.',
    },
    bloodline: {
      speaker: 'The Door is Shut',
      text: 'Your wallet holds no Bloodline.\n\nPress MINT to raise one. Nothing here is counted without it.',
    },
    unbound: {
      speaker: 'The Door is Shut',
      text: 'You hold a Bloodline but have not taken one up.\n\nPress WALLET to choose which line walks today.',
    },
    // Not a door that is shut for a reason you can fix — the run is over. It
    // says so plainly and does not send anyone to the mint, which would take
    // their money for a line that can no longer earn.
    // Kept SHORT on purpose: main.js appends the player's own total, and the
    // box paginates anything that overflows — an ending that arrives as "1/2"
    // is a worse last impression than one that fits.
    ended: {
      speaker: 'The Abbey is Closed',
      text: 'Eight weeks are kept.\n\nNothing more is counted.',
    },
  },

  // The mint IS open. This said it was not, because it was written before the
  // collection existed and nobody came back to it — a player could read that
  // the rite had not begun and then scroll straight into the mint screen.
  // Two pages: what a Bloodline is, then what it costs and what a spirit is not.
  // One page. What a Bloodline costs and what a spirit is not were a second
  // page, and they are said again on the mint screen itself a moment later —
  // the box now gets out of the way and lets the rite do the explaining.
  mint: [
    {
      speaker: 'The Binding',
      text: 'A bloodline is raised here. Bound to your wallet.',
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
        + `His ${HANDS} are open, and they are waiting.`,
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
      text: `He closes his ${HANDS}.\n\n`
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
        + '"I can mend it, and not for nothing — the abbey does not forgive, '
        + 'it keeps accounts, and this will be a line in one."\n\n'
        + '"Kneel, or go."',
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

