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
// GBCommanderBanner — Automated Plant Banner temp HP for PF2e
//
// The Plant Banner feat (Commander 1, Battlecry! pg. 30) grants temporary HP
// to all allies within 30 feet of the commander at the start of each of the
// commander's turns. This class automates that via the pf2e.startTurn hook.
//
// Temp HP granted: 4 at level 1, +4 at 4th level and every 4 levels after.
//   Level 1–3: 4 | 4–7: 8 | 8–11: 12 | 12–15: 16 | 16–19: 20 | 20: 24
//
// The banner origin is the commander token's current position (i.e. the
// commander carries the banner with them). A future update will add a
// placeable aura token for cases where the banner is planted separately.
//
// Settings:
//   bannerHPChatCard  (default: false) — when true, posts a clickable chat
//   card instead of auto-applying. Visible to GM + the commander's owner.
//
// Manual usage (outside combat, from a hotbar macro):
//   const api = game.modules.get('greenbottles-toolbelt')?.api;
//   await api.commanderBanner.applyBannerHP();
// ════════════════════════════════════════════════════════════════════════════

class GBCommanderBanner {
  static BANNER_RANGE_FEET = 30;

  static initialize() {
    GBCommanderBanner._registerSettings();

    // Fires at the start of each combatant's turn — check if it's a commander.
    Hooks.on('pf2e.startTurn', combatant => GBCommanderBanner._onTurnStart(combatant));

    // Re-bind chat card buttons whenever a banner card is rendered/re-rendered.
    Hooks.on('renderChatMessage', (message, html) => GBCommanderBanner._bindChatCard(message, html));

    // Socket listener — lets non-GM commander players route apply requests
    // through the GM, who has permission to update other actors.
    Hooks.once('ready', () => {
      if (!game.user.isGM) return;
      game.socket.on('module.greenbottles-toolbelt', data => {
        if (data.action !== 'commanderBanner.apply') return;
        const token = canvas.tokens.get(data.tokenId);
        if (token) GBCommanderBanner._applyToAllies(token, data.tempHP);
      });
    });

    console.log("Greenbottle's Toolbelt | Commander Banner initialized");
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  static _registerSettings() {
    game.settings.register(GBToolbelt.MODULE_ID, 'bannerHPChatCard', {
      name: 'Plant Banner: Use Chat Card Prompt',
      hint: 'When enabled, a clickable chat card appears at the start of the '
        + "commander's turn instead of automatically applying temp HP. "
        + 'The GM and the commander\'s player can click it to apply.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false
    });
  }

  // ── Hook Handlers ─────────────────────────────────────────────────────────

  /**
   * Called on pf2e.startTurn. Only the GM processes this to avoid duplicate
   * writes — the GM always has permission to update all actors.
   * @param {CombatantPF2e} combatant
   */
  static _onTurnStart(combatant) {
    if (!game.user.isGM) return;

    const actor = combatant.actor;
    if (!actor || !GBCommanderBanner.isCommanderWithBanner(actor)) return;

    // Prefer the live canvas token object; fall back via document.
    const token = canvas.tokens.get(combatant.tokenId) ?? combatant.token?.object;
    if (!token) {
      console.warn('GBCommanderBanner | Token not found on canvas for:', combatant.name);
      return;
    }

    const level  = actor.system.details.level.value;
    const tempHP = GBCommanderBanner.calcTempHP(level);

    if (game.settings.get(GBToolbelt.MODULE_ID, 'bannerHPChatCard')) {
      GBCommanderBanner._postChatCard(token, tempHP);
    } else {
      GBCommanderBanner._applyToAllies(token, tempHP);
    }
  }

  // ── Chat Card ─────────────────────────────────────────────────────────────

  /**
   * Posts a whispered chat card with an Apply button.
   * Recipients: all GMs + the non-GM owner of the commander actor (if any).
   * @param {Token}  commanderToken
   * @param {number} tempHP
   */
  static async _postChatCard(commanderToken, tempHP) {
    const actor = commanderToken.actor;
    const owner = game.users.find(u => !u.isGM && actor.testUserPermission(u, 'OWNER'));
    const whisper = [
      ...ChatMessage.getWhisperRecipients('GM'),
      ...(owner ? [owner] : [])
    ];

    await ChatMessage.create({
      content: `
        <div class="gb-banner-card">
          <h3>⚑ Plant Banner — ${actor.name}</h3>
          <p>Grants <strong>${tempHP} temporary HP</strong> to allies within 30 feet.</p>
          <button data-action="gb-apply-banner-hp"
                  data-token-id="${commanderToken.id}"
                  data-temp-hp="${tempHP}">
            Apply Banner HP
          </button>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper,
      flags: {
        [GBToolbelt.MODULE_ID]: { bannerCard: true, tokenId: commanderToken.id, tempHP }
      }
    });
  }

  /**
   * Binds the Apply button on a Plant Banner chat card.
   * Handles both GM clicks (direct) and commander-player clicks (via socket).
   * Persists the applied state so the button stays disabled after re-renders.
   * @param {ChatMessage} message
   * @param {jQuery}      html
   */
  static _bindChatCard(message, html) {
    const flags = message.flags?.[GBToolbelt.MODULE_ID];
    if (!flags?.bannerCard) return;

    const btn = html[0].querySelector('[data-action="gb-apply-banner-hp"]');
    if (!btn) return;

    // Already applied — disable and update label without re-binding.
    if (flags.applied) {
      btn.disabled = true;
      btn.textContent = 'Applied ✓';
      return;
    }

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Applying…';

      const tokenId = btn.dataset.tokenId;
      const tempHP  = Number(btn.dataset.tempHp);
      const token   = canvas.tokens.get(tokenId);

      if (!token) {
        ui.notifications.warn('GBCommanderBanner | Banner token not found on scene.');
        btn.disabled = false;
        btn.textContent = 'Apply Banner HP';
        return;
      }

      if (game.user.isGM) {
        await GBCommanderBanner._applyToAllies(token, tempHP);
      } else {
        // Non-GM: route through GM via socket.
        game.socket.emit('module.greenbottles-toolbelt', {
          action: 'commanderBanner.apply',
          tokenId,
          tempHP
        });
      }

      // Persist so the button stays disabled if the chat log re-renders.
      await message.setFlag(GBToolbelt.MODULE_ID, 'applied', true);
      btn.textContent = 'Applied ✓';
    });
  }

  // ── Application ───────────────────────────────────────────────────────────

  /**
   * Grants temp HP to all FRIENDLY tokens within the banner burst radius
   * of the given commander token. Posts a GM-only summary to chat and shows
   * a brief toast notification for each actor that received temp HP.
   * @param {Token}  commanderToken  Token whose position is the burst origin.
   * @param {number} tempHP
   */
  static async _applyToAllies(commanderToken, tempHP) {
    const alliedTokens = GBCommanderBanner.findAlliedTokens();
    const lines = [];

    for (const allied of alliedTokens) {
      const dist = GBCommanderBanner.getDistanceFeet(commanderToken, allied);
      if (dist > GBCommanderBanner.BANNER_RANGE_FEET) continue;

      const { updated, prev, next } = await GBCommanderBanner.applyTempHP(allied.actor, tempHP);

      if (updated) {
        const change = prev > 0 ? `${prev} → ${next}` : `${next}`;
        lines.push(`<li>✓ <b>${allied.name}</b> — ${change} temp HP</li>`);
        ui.notifications.info(`${allied.name}: ${change} temp HP (Plant Banner)`);
      } else {
        lines.push(`<li>— <b>${allied.name}</b> — already had ${prev} temp HP (> ${tempHP})</li>`);
      }
    }

    if (lines.length === 0) {
      lines.push('<li><em>No allies in range.</em></li>');
    }

    ChatMessage.create({
      content: `<h3>⚑ Plant Banner — ${commanderToken.name} (${tempHP} temp HP)</h3>`
        + `<ul style="margin:0.25em 0; padding-left:1.25em">${lines.join('')}</ul>`,
      whisper: ChatMessage.getWhisperRecipients('GM')
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Manually scan the scene for commanders and apply banner HP.
   * Respects the bannerHPChatCard setting.
   * Useful outside of active combat (e.g. from a hotbar macro).
   */
  static async applyBannerHP() {
    if (!canvas.scene) {
      return ui.notifications.warn('GBCommanderBanner | No active scene.');
    }

    const bannerTokens = GBCommanderBanner.findBannerTokens();
    if (bannerTokens.length === 0) {
      return ui.notifications.warn(
        'No tokens with Commander class/archetype and Plant Banner found on this scene.'
      );
    }

    const useChatCard = game.settings.get(GBToolbelt.MODULE_ID, 'bannerHPChatCard');
    for (const token of bannerTokens) {
      const level  = token.actor.system.details.level.value;
      const tempHP = GBCommanderBanner.calcTempHP(level);
      if (useChatCard) {
        await GBCommanderBanner._postChatCard(token, tempHP);
      } else {
        await GBCommanderBanner._applyToAllies(token, tempHP);
      }
    }
  }

  // ── Scene Queries ─────────────────────────────────────────────────────────

  /**
   * All tokens on the current scene that qualify as banner commanders.
   * @returns {Token[]}
   */
  static findBannerTokens() {
    return canvas.tokens.placeables.filter(t => GBCommanderBanner.isCommanderWithBanner(t.actor));
  }

  /**
   * All FRIENDLY-disposition tokens on the current scene.
   * @returns {Token[]}
   */
  static findAlliedTokens() {
    return canvas.tokens.placeables.filter(t =>
      t.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
    );
  }

  // ── Feat / Class Detection ────────────────────────────────────────────────

  static _hasCommanderClass(actor) {
    return actor.itemTypes.class?.some(c => c.system.slug === 'commander') ?? false;
  }

  static _hasCommanderArchetype(actor) {
    return actor.itemTypes.feat?.some(f => f.system.slug === 'commander-dedication') ?? false;
  }

  static _hasPlantBanner(actor) {
    return actor.itemTypes.feat?.some(f => f.system.slug === 'plant-banner') ?? false;
  }

  /**
   * Returns true if the actor qualifies as a banner commander:
   * (Commander class OR Commander Dedication) AND Plant Banner feat.
   * @param {Actor} actor
   */
  static isCommanderWithBanner(actor) {
    if (!actor) return false;
    const hasCommander = GBCommanderBanner._hasCommanderClass(actor)
      || GBCommanderBanner._hasCommanderArchetype(actor);
    return hasCommander && GBCommanderBanner._hasPlantBanner(actor);
  }

  // ── Math ──────────────────────────────────────────────────────────────────

  /**
   * Temp HP formula for Plant Banner.
   * 4 at level 1, +4 at 4th level and every 4 levels thereafter.
   * Level 1–3: 4 | 4–7: 8 | 8–11: 12 | 12–15: 16 | 16–19: 20 | 20: 24
   * @param {number} level
   * @returns {number}
   */
  static calcTempHP(level) {
    return 4 + Math.floor(level / 4) * 4;
  }

  /**
   * Grid-based distance in feet between two token centers.
   * @param {Token} tokenA
   * @param {Token} tokenB
   * @returns {number}
   */
  static getDistanceFeet(tokenA, tokenB) {
    return canvas.grid.measureDistance(tokenA.center, tokenB.center, { gridSpaces: true });
  }

  /**
   * Apply temp HP to an actor only if the new value exceeds what they have.
   * PF2e temp HP does not stack — always take the highest.
   * @param {Actor}  actor
   * @param {number} tempHP
   * @returns {Promise<{updated: boolean, prev: number, next: number}>}
   */
  static async applyTempHP(actor, tempHP) {
    const prev = actor.system.attributes.hp?.temp ?? 0;
    if (tempHP <= prev) return { updated: false, prev, next: prev };
    await actor.update({ 'system.attributes.hp.temp': tempHP });
    return { updated: true, prev, next: tempHP };
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
  GBCommanderBanner.initialize();
});
