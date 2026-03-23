/**
 * Place Commander's Banner
 *
 * Drag this macro to your hotbar for quick access.
 *
 * Usage:
 *   1. Select your commander token on the canvas.
 *   2. Click this macro.
 *   3. A Portal crosshair will appear — click the tile where the banner is planted.
 *
 * The banner token and its 30ft aura template will be placed at that location.
 * The Plant Banner automation will use the banner's position (instead of the
 * commander's position) as the burst origin for temp HP each turn.
 *
 * Requires: Greenbottle's Toolbelt + Portal (portal-lib)
 */

const api = game.modules.get('greenbottles-toolbelt')?.api;

if (!api) {
  ui.notifications.error("Greenbottle's Toolbelt is not active!");
} else {
  await api.commanderBanner.placeBanner();
}
