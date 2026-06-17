/**
 * Runesmith — Invoke Rune
 *
 * Usage:
 *   1. Select your Runesmith token on the canvas.
 *   2. Click this macro.
 *   3. Pick which active rune to invoke → Invoke.
 *   4. The target's save is rolled, damage is applied, rune is removed.
 *
 * Requires: Greenbottle's Toolbelt (+ socketlib for non-GM use)
 */

const api = game.modules.get('greenbottles-toolbelt')?.api;

if (!api) {
  ui.notifications.error("Greenbottle's Toolbelt is not active!");
} else {
  await api.runesmith.invokeRune();
}
