/**
 * Runesmith — Trace Rune
 *
 * Usage:
 *   1. Select your Runesmith token on the canvas.
 *   2. Target the creature to inscribe.
 *   3. Click this macro.
 *   4. Pick a rune (and optional diacritic) → Inscribe.
 *
 * Requires: Greenbottle's Toolbelt (+ socketlib for non-GM use)
 */

const api = game.modules.get('greenbottles-toolbelt')?.api;

if (!api) {
  ui.notifications.error("Greenbottle's Toolbelt is not active!");
} else {
  await api.runesmith.traceRune();
}
