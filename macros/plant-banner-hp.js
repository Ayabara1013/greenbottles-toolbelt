/**
 * Plant Banner — Manual Trigger Macro
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE: Under normal circumstances you do NOT need this macro.
 * The Plant Banner temp HP is applied automatically at the start of the
 * commander's turn via the pf2e.startTurn hook — no manual intervention needed.
 *
 * Use this macro only when you need to trigger the banner HP outside of active
 * combat (e.g. during exploration mode, or to manually force a re-application).
 *
 * To use: paste this script into a Foundry macro and drag it to your hotbar.
 *
 * Requirements:
 *   - Greenbottle's Toolbelt must be active.
 *   - The commander token must be on the current scene.
 *   - The commander's actor must have:
 *       • The "Commander" class (slug: 'commander')
 *         OR the "Commander Dedication" feat (slug: 'commander-dedication')
 *       • The "Plant Banner" feat (slug: 'plant-banner')
 *
 * The "Plant Banner: Use Chat Card Prompt" module setting (default: off) also
 * applies here — when enabled, this posts a clickable card instead of
 * applying temp HP immediately.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const api = game.modules.get('greenbottles-toolbelt')?.api;

if (!api) {
  ui.notifications.error("Greenbottle's Toolbelt is not active!");
} else {
  await api.commanderBanner.applyBannerHP();
}
