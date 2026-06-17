/**
 * Runesmith — One-Time Rune Setup
 *
 * Run this once with your Runesmith token selected to attach invocation
 * data to each of your rune items. This data is read by the Invoke Rune
 * macro when triggering a rune's effect.
 *
 * Re-run any time you want to update or add a new rune's data.
 */

const MODULE = 'greenbottles-toolbelt';
const actor  = canvas.tokens.controlled[0]?.actor;

if (!actor) {
  ui.notifications.warn('Runesmith Setup | Select your Runesmith token first.');
  return;
}

// ── Rune invocation definitions ───────────────────────────────────────────────
//
// namePattern  Regex matched against item name (case-insensitive).
// damage       Damage roll formula.
// damageType   SF2e damage type string.
// saveAbility  'fortitude' | 'reflex' | 'will'
// saveDC       Base DC of the save.
// basicSave    true = Basic save (crit success: no dmg, success: half,
//                                 failure: full, crit fail: double).
// critFail     Optional condition applied on a critical failure.
//   .slug        Foundry condition slug (e.g. 'dazzled', 'stunned').
//   .rounds      Duration in rounds (0 = until cleared).
// levelScaling Optional heightened damage scaling.
//   .per         Rune level increment that adds more damage.
//   .bonus       Additional damage formula added per increment.

const RUNE_DEFINITIONS = [
  {
    namePattern: /atryl.*fire|rune of fire/i,
    damage:      '2d6',
    damageType:  'fire',
    saveAbility: 'fortitude',
    saveDC:      17,
    basicSave:   true,
    critFail:    { slug: 'dazzled', rounds: 1 },
    levelScaling: { per: 2, bonus: '2d6' },
  },

  // ── Add your other runes below ─────────────────────────────────────────────
  // Example for Ranshu, Rune of Thunder (fill in correct values from rulebook):
  // {
  //   namePattern: /ranshu.*thunder|rune of thunder/i,
  //   damage:      '2d6',
  //   damageType:  'electricity',
  //   saveAbility: 'fortitude',
  //   saveDC:      17,
  //   basicSave:   true,
  //   critFail:    null,
  //   levelScaling: { per: 2, bonus: '2d6' },
  // },
];

// ── Apply to matching items ───────────────────────────────────────────────────

let updated = 0;
let skipped = 0;

for (const def of RUNE_DEFINITIONS) {
  const item = actor.items.find(i => def.namePattern.test(i.name));

  if (!item) {
    console.warn(`Runesmith Setup | No item matched pattern: ${def.namePattern}`);
    skipped++;
    continue;
  }

  const existing = item.getFlag(MODULE, 'invocation');
  if (existing) {
    console.log(`Runesmith Setup | "${item.name}" already has invocation data — overwriting.`);
  }

  const { namePattern, ...data } = def;   // strip the pattern, store the rest
  await item.setFlag(MODULE, 'invocation', data);
  console.log(`Runesmith Setup | "${item.name}" updated:`, data);
  updated++;
}

// ── Summary ───────────────────────────────────────────────────────────────────

if (updated === 0 && skipped === RUNE_DEFINITIONS.length) {
  ui.notifications.warn(
    'Runesmith Setup | No matching rune items found. '
    + 'Check that the namePattern entries match your item names exactly.'
  );
} else {
  ui.notifications.info(
    `Runesmith Setup | Done — ${updated} rune(s) configured`
    + (skipped ? `, ${skipped} not found.` : '.')
  );
}
