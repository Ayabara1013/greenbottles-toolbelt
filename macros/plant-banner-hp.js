/**
 * Plant Banner — Temp HP Macro
 * ─────────────────────────────────────────────────────────────────────────────
 * Paste this script into a Foundry macro and drag it to your GM hotbar.
 * Run it at the start of each round to refresh Plant Banner temp HP for all
 * allied tokens within range of a banner commander.
 *
 * Requirements:
 *   - Greenbottle's Toolbelt must be active.
 *   - The commander token must be on the current scene.
 *   - The commander's actor must have:
 *       • The "Commander" class (slug: 'commander')
 *         OR the "Commander Dedication" feat (slug: 'commander-dedication')
 *       • The "Plant Banner" feat (slug: 'plant-banner')
 *
 * Behaviour:
 *   - Detects all qualifying commander tokens on the scene automatically.
 *   - Grants temp HP to every FRIENDLY-disposition token within 30 feet.
 *   - Temp HP is only applied if the new value is higher than what the
 *     token already has (PF2e temp HP does not stack).
 *   - Whispers a summary of the results to the GM.
 *
 * Banner position note:
 *   This macro uses the commander token's current position as the banner
 *   origin. If the commander has moved away from their planted banner,
 *   temporarily move the commander token (or place a marker token) at the
 *   banner's location before running the macro, then move it back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const api = game.modules.get('greenbottles-toolbelt')?.api;

if (!api) {
  ui.notifications.error("Greenbottle's Toolbelt is not active!");
} else {
  await api.commanderBanner.applyBannerHP();
}
