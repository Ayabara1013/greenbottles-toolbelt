/**
 * Greenbottle's Toolbelt — Shared utility library for all Greenbottle's modules.
 *
 * Usage from a dependent module:
 *   const GBToolbelt = game.modules.get('greenbottles-toolbelt')?.api;
 *   if (!GBToolbelt) return ui.notifications.error('Greenbottle\'s Toolbelt is required.');
 *   GBToolbelt.updateActorResource(actor, 'system.resources.heroPoints.value', 2);
 */

class GBToolbelt {
  static MODULE_ID = 'greenbottles-toolbelt';

  static initialize() {
    console.log("Greenbottle's Toolbelt | Initialized");
  }

  // ── Actor Resources ────────────────────────────────────────────────────────

  /**
   * Read a nested property from an actor using a dot-separated path.
   * @param {Actor} actor
   * @param {string} resourcePath  e.g. 'system.resources.heroPoints.value'
   * @returns {*}
   */
  static getActorResource(actor, resourcePath) {
    return resourcePath.split('.').reduce((obj, key) => obj?.[key], actor);
  }

  /**
   * Update a nested actor resource. Clamps the value between 0 and the
   * corresponding `.max` field if one exists at the same path level.
   *
   * @param {Actor}  actor
   * @param {string} resourcePath  e.g. 'system.resources.vitalityNetwork.value'
   * @param {number} newValue
   * @param {object} [options]
   * @param {boolean} [options.notify=true]  Show a ui.notifications message on success.
   * @param {string}  [options.label]        Human-readable label for the notification.
   * @returns {Promise<Actor>}
   */
  static async updateActorResource(actor, resourcePath, newValue, { notify = true, label } = {}) {
    // Clamp to [0, max] if a matching max field exists
    const maxPath = resourcePath.replace(/\.value$/, '.max');
    const max = GBToolbelt.getActorResource(actor, maxPath);
    if (typeof max === 'number') {
      newValue = Math.max(0, Math.min(newValue, max));
    } else {
      newValue = Math.max(0, newValue);
    }

    const result = await actor.update({ [resourcePath]: newValue });

    if (notify) {
      const resourceName = label ?? resourcePath.split('.').at(-2) ?? 'resource';
      ui.notifications.info(`${actor.name}: ${resourceName} set to ${newValue}`);
    }

    return result;
  }

  // ── World Item Search ──────────────────────────────────────────────────────

  /**
   * Find items across both the world item directory and every actor's inventory.
   * Returns a flat array (may contain duplicates if an item appears in multiple actors).
   *
   * @param {function(Item): boolean} filterFn  Predicate to filter items.
   * @returns {Item[]}
   */
  static findWorldItems(filterFn) {
    const items = game.items.filter(filterFn);
    for (const actor of game.actors) {
      items.push(...actor.items.filter(filterFn));
    }
    return items;
  }

  // ── Module Data Loading ────────────────────────────────────────────────────

  /**
   * Load JSON data for a module. If customPath is provided and the file exists,
   * its entries are merged on top of the primary data (custom entries win).
   *
   * @param {string}      moduleId     e.g. 'greenbottles-hacking-quips'
   * @param {string}      primaryPath  Path relative to Foundry root, e.g. 'modules/my-mod/data/trees.json'
   * @param {string|null} [customPath] Optional override file path.
   * @returns {Promise<any>}
   */
  static async loadModuleData(moduleId, primaryPath, customPath = null) {
    let data;

    try {
      const response = await fetch(primaryPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (err) {
      console.error(`GBToolbelt | Failed to load primary data from ${primaryPath}:`, err);
      return null;
    }

    if (customPath) {
      try {
        const customResponse = await fetch(customPath);
        if (customResponse.ok) {
          const customData = await customResponse.json();
          // Merge: custom wins. Works for both arrays (concat) and objects (spread).
          if (Array.isArray(data) && Array.isArray(customData)) {
            data = [...data, ...customData];
          } else if (typeof data === 'object' && typeof customData === 'object') {
            data = { ...data, ...customData };
          }
          console.log(`GBToolbelt | Merged custom data from ${customPath}`);
        }
      } catch {
        // Custom file is optional — silently skip if missing or invalid.
      }
    }

    return data;
  }

  // ── Module Registry ────────────────────────────────────────────────────────

  /**
   * Check whether a module is installed and currently active.
   * @param {string} moduleId
   * @returns {boolean}
   */
  static isModuleActive(moduleId) {
    return game.modules.get(moduleId)?.active === true;
  }

  // ── Settings Helpers ───────────────────────────────────────────────────────

  /**
   * Thin wrapper around game.settings.register.
   * @param {string} moduleId
   * @param {string} key
   * @param {object} options  Standard Foundry settings options.
   */
  static registerSetting(moduleId, key, options) {
    game.settings.register(moduleId, key, options);
  }

  /**
   * @param {string} moduleId
   * @param {string} key
   * @returns {*}
   */
  static getSetting(moduleId, key) {
    return game.settings.get(moduleId, key);
  }

  /**
   * @param {string} moduleId
   * @param {string} key
   * @param {*}      value
   * @returns {Promise<*>}
   */
  static setSetting(moduleId, key, value) {
    return game.settings.set(moduleId, key, value);
  }
}


// ════════════════════════════════════════════════════════════════════════════
// GBHeroPoints — GM toolbar button for bulk hero point management (PF2e)
//
// Migrated from the standalone greenbottles-toolbelt__hero-points module.
// Adds a star button to the Token Controls toolbar (GM only). Clicking it
// opens a dialog with four bulk operations for the whole party:
//   - Add 1      → increment every member by 1 (stops at max)
//   - Set all to 2 → set everyone to exactly 2
//   - Top up     → bring anyone below 2 up to 2 (skips those already at 2+)
//   - Clear      → set everyone to 0
// ════════════════════════════════════════════════════════════════════════════

class GBHeroPoints {
  /** PF2e path for a character's hero point value. */
  static RESOURCE_PATH = 'system.resources.heroPoints.value';

  static initialize() {
    GBHeroPoints.registerSettings();
    Hooks.on('getSceneControlButtons', controls => GBHeroPoints._addToolbarButton(controls));
    Hooks.once('ready', () => GBHeroPoints.sessionStartCheck());
    console.log("Greenbottle's Toolbelt | Hero Points initialized");
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  static registerSettings() {
    game.settings.register(GBToolbelt.MODULE_ID, 'sessionTopUpEnabled', {
      name: 'Session Start: Enable Top-Up Prompt',
      hint: 'When enabled, a prompt appears at the start of each session to top up party hero points.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false
    });

    game.settings.register(GBToolbelt.MODULE_ID, 'sessionTopUpAmount', {
      name: 'Session Start: Top-Up Amount',
      hint: 'Party members below this value will be topped up to this amount when the session starts.',
      scope: 'world',
      config: true,
      type: Number,
      default: 1
    });

    game.settings.register(GBToolbelt.MODULE_ID, 'sessionTopUpCooldownHours', {
      name: 'Session Start: Cooldown (hours)',
      hint: 'Minimum hours between prompts. Prevents the dialog from re-appearing when the GM reloads mid-session. Set to 0 to always prompt on load.',
      scope: 'world',
      config: true,
      type: Number,
      default: 4
    });

    // Hidden — stores timestamp (ms) of the last time the prompt was shown.
    game.settings.register(GBToolbelt.MODULE_ID, 'sessionTopUpLastTriggered', {
      scope: 'world',
      config: false,
      type: Number,
      default: 0
    });
  }

  // ── Session Start ─────────────────────────────────────────────────────────

  /**
   * Called on the 'ready' hook. Checks whether the session-start top-up
   * prompt should appear based on the enabled flag and the cooldown window.
   */
  static sessionStartCheck() {
    if (!game.user.isGM) return;
    if (!game.settings.get(GBToolbelt.MODULE_ID, 'sessionTopUpEnabled')) return;

    const party = game.actors.party?.members;
    if (!party || party.length === 0) return;

    const lastTriggered = game.settings.get(GBToolbelt.MODULE_ID, 'sessionTopUpLastTriggered');
    const cooldownHours = game.settings.get(GBToolbelt.MODULE_ID, 'sessionTopUpCooldownHours');
    const cooldownMs = cooldownHours * 3_600_000;

    if (cooldownMs > 0 && Date.now() - lastTriggered < cooldownMs) return;

    // Delay slightly so the world is fully settled before the dialog appears.
    setTimeout(() => GBHeroPoints.sessionStartPrompt(), 3000);
  }

  /**
   * Shows the session-start top-up dialog. Updating the timestamp on both
   * confirm and skip ensures the cooldown suppresses repeats on mid-session reloads.
   */
  static sessionStartPrompt() {
    const party = game.actors.party?.members;
    if (!party || party.length === 0) return;

    const amount = game.settings.get(GBToolbelt.MODULE_ID, 'sessionTopUpAmount');

    new Dialog({
      title: 'Session Start — Hero Points',
      content: `<p>Top up all party members to <strong>${amount}</strong> hero point(s)?</p>`,
      buttons: {
        topUp: {
          label: 'Top up',
          callback: async () => {
            await GBHeroPoints.updateParty(amount, party, 'top-up');
            await game.settings.set(GBToolbelt.MODULE_ID, 'sessionTopUpLastTriggered', Date.now());
          }
        },
        skip: {
          label: 'Skip',
          callback: async () => {
            await game.settings.set(GBToolbelt.MODULE_ID, 'sessionTopUpLastTriggered', Date.now());
          }
        }
      },
      default: 'topUp'
    }).render(true);
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────

  /**
   * Injects the "Assign Hero Points" button into the Token Controls section.
   * Only visible to GMs.
   * @param {SceneControl[]} controls  The full controls array from the hook.
   */
  static _addToolbarButton(controls) {
    if (!game.user.isGM) return;

    const tokenControls = controls.find(c => c.name === 'token');
    if (!tokenControls) {
      console.error("GBHeroPoints | Token controls not found — cannot add Hero Points button.");
      return;
    }

    tokenControls.tools.push({
      name: 'heroPoints',
      title: 'Assign Hero Points',
      icon: 'fas fa-star',
      onClick: () => GBHeroPoints.openDialog(),
      button: true
    });
  }

  // ── Dialog ────────────────────────────────────────────────────────────────

  /**
   * Opens the Hero Points dialog. Reads the current PF2e party from
   * game.actors.party and passes it to each button's callback.
   */
  static openDialog() {
    const party = game.actors.party?.members;

    if (!party || party.length === 0) {
      ui.notifications.warn('No party members found in the Pathfinder 2e party!');
      return;
    }

    new Dialog({
      title: 'Assign Hero Points',
      content: `<p>How many hero points should party members receive?</p>`,
      buttons: {
        one:   { label: 'Add 1',        callback: () => GBHeroPoints.updateParty(1, party, 'add') },
        two:   { label: 'Set all to 2', callback: () => GBHeroPoints.updateParty(2, party, 'set') },
        three: { label: 'Top up',       callback: () => GBHeroPoints.updateParty(2, party, 'top-up') },
        four:  { label: 'Clear',        callback: () => GBHeroPoints.updateParty(0, party, 'set') }
      },
      default: 'two'  // "Set all to 2" is pre-selected
    }).render(true);
  }

  // ── Update Logic ──────────────────────────────────────────────────────────

  /**
   * Applies a hero point operation to every member of the party.
   * Uses GBToolbelt.updateActorResource() for safe clamped writes.
   *
   * @param {number}   amount  Target or delta value depending on mode.
   * @param {Actor[]}  party   Array of party member Actors.
   * @param {'add'|'set'|'top-up'} type  How to apply the amount:
   *   - 'add'    → add amount to current value (skips members already at max)
   *   - 'set'    → set everyone to exactly amount (also used for clear with amount=0)
   *   - 'top-up' → only update members whose current value is below amount
   */
  static async updateParty(amount, party, type) {
    for (const member of party) {
      const name = member.prototypeToken.name ?? member.name;
      const current = GBToolbelt.getActorResource(member, GBHeroPoints.RESOURCE_PATH);
      const max = GBToolbelt.getActorResource(member, 'system.resources.heroPoints.max');

      let newValue;

      if (type === 'add') {
        // Skip members already at the cap — adding more would have no effect.
        if (current >= max) {
          ui.notifications.info(`${name} is already at max hero points`);
          continue;
        }
        newValue = current + amount;

      } else if (type === 'set') {
        // Direct overwrite — covers both "set all to 2" and "clear" (amount=0).
        newValue = amount;

      } else if (type === 'top-up') {
        // Only bring members up to the target; skip anyone already there or above.
        if (current >= amount) {
          ui.notifications.info(`${name} already has enough hero points!`);
          continue;
        }
        newValue = amount;

      } else {
        console.error(`GBHeroPoints | Unknown update type: ${type}`);
        continue;
      }

      // GBToolbelt handles the actor.update() call, clamping, and the notification.
      await GBToolbelt.updateActorResource(member, GBHeroPoints.RESOURCE_PATH, newValue, {
        label: 'Hero Points'
      });
    }
  }
}


// ════════════════════════════════════════════════════════════════════════════
// GBCommanderBanner — Applies Plant Banner temp HP to allied tokens (PF2e)
//
// The Plant Banner feat (Commander 1, Battlecry! pg. 30) allows a Commander
// to plant their banner and grant temporary HP to allies within a 30-foot
// burst each round. This class handles the detection and application logic.
//
// Temp HP granted: 4 at level 1, +4 at 4th level and every 4 levels after.
//   Level 1–3: 4 | 4–7: 8 | 8–11: 12 | 12–15: 16 | 16–19: 20 | 20: 24
//
// Usage (from a Foundry macro):
//   const api = game.modules.get('greenbottles-toolbelt')?.api;
//   await api.commanderBanner.applyBannerHP();
//
// NOTE: This macro uses the commander token's current position as the banner
// origin. If the commander has moved away from their planted banner, move the
// banner token (or a marker token) to the planted location and run the macro
// targeting that token manually — a future update may formalize this flow.
// ════════════════════════════════════════════════════════════════════════════

class GBCommanderBanner {
  static BANNER_RANGE_FEET = 30;

  // ── Feat/Class Detection ──────────────────────────────────────────────────

  /**
   * Returns true if the actor has the Commander class.
   * @param {Actor} actor
   */
  static _hasCommanderClass(actor) {
    return actor.itemTypes.class?.some(c => c.system.slug === 'commander') ?? false;
  }

  /**
   * Returns true if the actor has the Commander Dedication feat (archetype).
   * @param {Actor} actor
   */
  static _hasCommanderArchetype(actor) {
    return actor.itemTypes.feat?.some(f => f.system.slug === 'commander-dedication') ?? false;
  }

  /**
   * Returns true if the actor has the Plant Banner feat.
   * @param {Actor} actor
   */
  static _hasPlantBanner(actor) {
    return actor.itemTypes.feat?.some(f => f.system.slug === 'plant-banner') ?? false;
  }

  /**
   * Returns true if the actor qualifies as a banner commander:
   * must have the Commander class OR Commander Dedication archetype,
   * AND must have the Plant Banner feat.
   * @param {Actor} actor
   */
  static isCommanderWithBanner(actor) {
    if (!actor) return false;
    const hasCommander = GBCommanderBanner._hasCommanderClass(actor)
      || GBCommanderBanner._hasCommanderArchetype(actor);
    return hasCommander && GBCommanderBanner._hasPlantBanner(actor);
  }

  // ── Scene Queries ─────────────────────────────────────────────────────────

  /**
   * Find all tokens on the current scene that are commanders with Plant Banner.
   * @returns {Token[]}
   */
  static findBannerTokens() {
    return canvas.tokens.placeables.filter(t =>
      GBCommanderBanner.isCommanderWithBanner(t.actor)
    );
  }

  /**
   * Find all allied (FRIENDLY disposition) tokens on the current scene.
   * @returns {Token[]}
   */
  static findAlliedTokens() {
    return canvas.tokens.placeables.filter(t =>
      t.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
    );
  }

  // ── Math ──────────────────────────────────────────────────────────────────

  /**
   * Calculate temp HP granted by Plant Banner for a given commander level.
   * Formula: 4 + floor(level / 4) * 4
   * @param {number} level
   * @returns {number}
   */
  static calcTempHP(level) {
    return 4 + Math.floor(level / 4) * 4;
  }

  /**
   * Measure the distance in feet between two tokens using Foundry's grid system.
   * @param {Token} tokenA
   * @param {Token} tokenB
   * @returns {number}
   */
  static getDistanceFeet(tokenA, tokenB) {
    return canvas.grid.measureDistance(tokenA.center, tokenB.center, { gridSpaces: true });
  }

  // ── Application ───────────────────────────────────────────────────────────

  /**
   * Apply temp HP to an actor if the new value is higher than what they
   * already have. PF2e temp HP doesn't stack — always take the highest.
   *
   * @param {Actor}  actor
   * @param {number} tempHP
   * @returns {Promise<boolean>}  true if the actor was updated.
   */
  static async applyTempHP(actor, tempHP) {
    const current = actor.system.attributes.hp?.temp ?? 0;
    if (tempHP <= current) return false;
    await actor.update({ 'system.attributes.hp.temp': tempHP });
    return true;
  }

  /**
   * Main entry point — finds all Commander+Plant Banner tokens on the scene,
   * then grants temp HP to every allied token within the 30-foot burst.
   * Whispers a summary to the GM.
   */
  static async applyBannerHP() {
    if (!canvas.scene) {
      return ui.notifications.warn('GBCommanderBanner | No active scene.');
    }

    const bannerTokens = GBCommanderBanner.findBannerTokens();
    if (bannerTokens.length === 0) {
      return ui.notifications.warn(
        'No tokens with the Commander class/archetype and Plant Banner feat found on this scene.'
      );
    }

    const alliedTokens = GBCommanderBanner.findAlliedTokens();
    const summaryLines = [];

    for (const bannerToken of bannerTokens) {
      const actor      = bannerToken.actor;
      const level      = actor.system.details.level.value;
      const tempHP     = GBCommanderBanner.calcTempHP(level);
      const buffed     = [];
      const alreadyAt  = [];

      for (const allied of alliedTokens) {
        const dist = GBCommanderBanner.getDistanceFeet(bannerToken, allied);
        if (dist <= GBCommanderBanner.BANNER_RANGE_FEET) {
          const updated = await GBCommanderBanner.applyTempHP(allied.actor, tempHP);
          (updated ? buffed : alreadyAt).push(allied.name);
        }
      }

      const buffedStr    = buffed.length    ? buffed.join(', ')    : '<em>none</em>';
      const alreadyStr   = alreadyAt.length ? ` (already at ${tempHP}+: ${alreadyAt.join(', ')})` : '';
      summaryLines.push(
        `<b>⚑ ${bannerToken.name}'s Banner</b> — <b>${tempHP} temp HP</b> (lv. ${level})<br>`
        + `Granted: ${buffedStr}${alreadyStr}`
      );
    }

    ChatMessage.create({
      content : `<h3>Plant Banner — Temp HP Applied</h3>` + summaryLines.map(l => `<p>${l}</p>`).join(''),
      whisper : ChatMessage.getWhisperRecipients('GM')
    });
  }
}


// ── Entry point ──────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  const module = game.modules.get(GBToolbelt.MODULE_ID);
  if (module) {
    GBToolbelt.commanderBanner = GBCommanderBanner;
    module.api = GBToolbelt;
  }
  GBToolbelt.initialize();
  GBHeroPoints.initialize();
});
