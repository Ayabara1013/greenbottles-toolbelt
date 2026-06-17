/**
 * Cast Elemental Weapon
 *
 * Drag this macro to your hotbar for quick access.
 *
 * Usage:
 *   1. Select your caster token on the canvas.
 *   2. Target the creature that should receive the weapon.
 *   3. Click this macro.
 *   4. Choose an element, then pick a weapon from the list.
 *
 * The weapon will appear in the target's inventory with elemental damage added.
 * An "Effect: Elemental Weapon" tracks the 10-minute duration — when it
 * expires or is removed, the weapon is automatically deleted.
 *
 * Requires: Greenbottle's Toolbelt (+ socketlib for non-GM casting)
 */

const api = game.modules.get('greenbottles-toolbelt')?.api;

if (!api) {
  ui.notifications.error("Greenbottle's Toolbelt is not active!");
} else {
  await api.elementalWeapon.cast();
}
