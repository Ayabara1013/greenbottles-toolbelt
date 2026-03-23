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
// to all allies within 30 feet of the banner at the start of each of the
// commander's turns. This class automates that via the pf2e.startTurn hook.
//
// Phase 1 — Automation:
//   Fires on pf2e.startTurn. If the combatant has the Commander class (or
//   Commander Dedication archetype) and the Plant Banner feat, temp HP is
//   applied to all FRIENDLY tokens within 30 feet of the burst origin.
//
// Phase 2 — Planted Banner Token:
//   Call GBToolbelt.commanderBanner.placeBanner() (or the place-banner macro)
//   to use a Portal crosshair and plant a physical banner token on the scene.
//   While a banner token is deployed for a commander, the burst origin shifts
//   from the commander's position to the banner's position. A 30ft circle
//   template is placed alongside the token to visualise the aura. When combat
//   ends the GM is prompted to retrieve the banner (or it auto-cleans up if
//   the bannerAutoCleanup setting is enabled).
//
// Temp HP granted: 4 at level 1, +4 at 4th level and every 4 levels after.
//   Level 1–3: 4 | 4–7: 8 | 8–11: 12 | 12–15: 16 | 16–19: 20 | 20: 24
//
// Settings:
//   bannerHPChatCard   (default: false) — post a chat card prompt instead of
//                      auto-applying. Visible to GM + commander's player.
//   bannerAutoCleanup  (default: false) — auto-delete banner tokens on combat
//                      end. When false a Retrieve button appears in chat.
//
// Manual usage (outside combat, from a hotbar macro):
//   const api = game.modules.get('greenbottles-toolbelt')?.api;
//   await api.commanderBanner.applyBannerHP();   // apply HP now
//   await api.commanderBanner.placeBanner();     // open placement cursor
// ════════════════════════════════════════════════════════════════════════════

class GBCommanderBanner {
  static BANNER_RANGE_FEET    = 30;
  static BANNER_ACTOR_FLAG    = 'isBannerActor';
  static BANNER_TOKEN_FLAG    = 'isBannerToken';
  static BANNER_TEMPLATE_FLAG = 'isBannerTemplate';
  static BANNER_ACTOR_NAME    = "Commander's Banner";
  static BANNER_ACTOR_FOLDER  = "Greenbottle's Toolbelt";
  static BANNER_ICON          = 'icons/sundries/flags/banner-flag-yellow-red.webp';

  static initialize() {
    GBCommanderBanner._registerSettings();

    // Fires at the start of each combatant's turn — check if it's a commander.
    Hooks.on('pf2e.startTurn', combatant => GBCommanderBanner._onTurnStart(combatant));

    // Re-bind chat card buttons whenever a banner card is rendered/re-rendered.
    Hooks.on('renderChatMessage', (message, html) => GBCommanderBanner._bindChatCard(message, html));

    // Post-combat banner cleanup.
    Hooks.on('deleteCombat', () => {
      if (!game.user.isGM) return;
      GBCommanderBanner._onCombatEnd();
    });

    Hooks.once('ready', () => {
      if (!game.user.isGM) return;

      // Ensure the "Commander's Banner" world actor exists on first load.
      GBCommanderBanner._ensureBannerActor();

      // Socket listeners — non-GM clients route GM-privileged actions here.
      game.socket.on('module.greenbottles-toolbelt', data => {
        if (data.action === 'commanderBanner.apply') {
          const token = canvas.tokens.get(data.tokenId);
          if (token) GBCommanderBanner._applyToAllies(token, data.tempHP);

        } else if (data.action === 'commanderBanner.place') {
          GBCommanderBanner._createBannerTokenAndTemplate(
            data.commanderTokenId, data.x, data.y, data.tempHP
          );

        } else if (data.action === 'commanderBanner.cleanup') {
          const tokens = canvas.tokens.placeables.filter(t =>
            t.document.flags?.[GBToolbelt.MODULE_ID]?.[GBCommanderBanner.BANNER_TOKEN_FLAG]
          );
          GBCommanderBanner._cleanupBannerTokens(tokens);
        }
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
        + "The GM and the commander's player can click it to apply.",
      scope: 'world',
      config: true,
      type: Boolean,
      default: false
    });

    game.settings.register(GBToolbelt.MODULE_ID, 'bannerAutoCleanup', {
      name: 'Plant Banner: Auto-Retrieve on Combat End',
      hint: 'When enabled, planted banner tokens and their aura templates are '
        + 'automatically removed when combat ends. When disabled, a Retrieve '
        + 'button appears in GM chat.',
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
   * If a planted banner token exists for this commander it is used as the
   * burst origin instead of the commander's current position.
   * @param {CombatantPF2e} combatant
   */
  static _onTurnStart(combatant) {
    if (!game.user.isGM) return;

    const actor = combatant.actor;
    if (!actor || !GBCommanderBanner.isCommanderWithBanner(actor)) return;

    const commanderToken = canvas.tokens.get(combatant.tokenId) ?? combatant.token?.object;
    if (!commanderToken) {
      console.warn('GBCommanderBanner | Token not found on canvas for:', combatant.name);
      return;
    }

    // Shift origin to the planted banner if one is deployed for this commander.
    const bannerToken = GBCommanderBanner._findBannerTokenForCommander(actor.id);
    const originToken = bannerToken ?? commanderToken;

    const level  = actor.system.details.level.value;
    const tempHP = GBCommanderBanner.calcTempHP(level);

    if (game.settings.get(GBToolbelt.MODULE_ID, 'bannerHPChatCard')) {
      GBCommanderBanner._postChatCard(originToken, tempHP, commanderToken);
    } else {
      GBCommanderBanner._applyToAllies(originToken, tempHP, commanderToken);
    }
  }

  // ── Chat Cards ────────────────────────────────────────────────────────────

  /**
   * Posts a whispered chat card with an Apply button.
   * Recipients: all GMs + the non-GM owner of the commander actor (if any).
   * @param {Token}      originToken     Burst origin (planted banner or commander).
   * @param {number}     tempHP
   * @param {Token|null} commanderToken  Commander token for display; null when it IS the origin.
   */
  static async _postChatCard(originToken, tempHP, commanderToken = null) {
    const displayToken = commanderToken ?? originToken;
    const actor        = displayToken.actor;
    const isBanner     = commanderToken !== null && originToken !== commanderToken;

    const owner   = game.users.find(u => !u.isGM && actor.testUserPermission(u, 'OWNER'));
    const whisper = [
      ...ChatMessage.getWhisperRecipients('GM'),
      ...(owner ? [owner] : [])
    ];

    await ChatMessage.create({
      content: `
        <div class="gb-banner-card">
          <h3>⚑ Plant Banner — ${actor.name}</h3>
          <p>Grants <strong>${tempHP} temporary HP</strong> to allies within 30 feet${isBanner ? ' of the planted banner' : ''}.</p>
          <button data-action="gb-apply-banner-hp"
                  data-token-id="${originToken.id}"
                  data-temp-hp="${tempHP}">
            Apply Banner HP
          </button>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper,
      flags: {
        [GBToolbelt.MODULE_ID]: { bannerCard: true, tokenId: originToken.id, tempHP }
      }
    });
  }

  /**
   * Routes renderChatMessage to the appropriate button binder.
   * @param {ChatMessage} message
   * @param {jQuery}      html
   */
  static _bindChatCard(message, html) {
    const flags = message.flags?.[GBToolbelt.MODULE_ID];
    if (!flags) return;
    if (flags.bannerCard)  GBCommanderBanner._bindApplyButton(message, html, flags);
    if (flags.cleanupCard) GBCommanderBanner._bindCleanupButton(message, html, flags);
  }

  /**
   * Binds the "Apply Banner HP" button on a banner chat card.
   * GM clicks apply directly; non-GM clicks route through the socket.
   */
  static _bindApplyButton(message, html, flags) {
    const btn = html[0].querySelector('[data-action="gb-apply-banner-hp"]');
    if (!btn) return;

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
        ui.notifications.warn('GBCommanderBanner | Origin token not found on scene.');
        btn.disabled = false;
        btn.textContent = 'Apply Banner HP';
        return;
      }

      if (game.user.isGM) {
        await GBCommanderBanner._applyToAllies(token, tempHP);
      } else {
        game.socket.emit('module.greenbottles-toolbelt', {
          action: 'commanderBanner.apply', tokenId, tempHP
        });
      }

      await message.setFlag(GBToolbelt.MODULE_ID, 'applied', true);
      btn.textContent = 'Applied ✓';
    });
  }

  /**
   * Binds the "Retrieve Banners" button on the post-combat cleanup card.
   */
  static _bindCleanupButton(message, html, flags) {
    const btn = html[0].querySelector('[data-action="gb-retrieve-banners"]');
    if (!btn) return;

    if (flags.applied) {
      btn.disabled = true;
      btn.textContent = 'Retrieved ✓';
      return;
    }

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Retrieving…';

      if (game.user.isGM) {
        const tokens = canvas.tokens.placeables.filter(t =>
          t.document.flags?.[GBToolbelt.MODULE_ID]?.[GBCommanderBanner.BANNER_TOKEN_FLAG]
        );
        await GBCommanderBanner._cleanupBannerTokens(tokens);
      } else {
        game.socket.emit('module.greenbottles-toolbelt', { action: 'commanderBanner.cleanup' });
      }

      await message.setFlag(GBToolbelt.MODULE_ID, 'applied', true);
      btn.textContent = 'Retrieved ✓';
    });
  }

  // ── Application ───────────────────────────────────────────────────────────

  /**
   * Grants temp HP to all FRIENDLY tokens within the banner burst radius
   * of the origin token. Banner tokens themselves are excluded.
   * Posts a GM-only summary to chat and shows a toast for each updated actor.
   * @param {Token}      originToken     Burst origin (planted banner or commander).
   * @param {number}     tempHP
   * @param {Token|null} commanderToken  Commander token for display label; null when it IS origin.
   */
  static async _applyToAllies(originToken, tempHP, commanderToken = null) {
    const displayToken = commanderToken ?? originToken;
    const isBanner     = commanderToken !== null && originToken !== commanderToken;
    const sourceLabel  = isBanner
      ? `${displayToken.name}'s planted banner`
      : displayToken.name;

    const alliedTokens = GBCommanderBanner.findAlliedTokens();
    const lines = [];

    for (const allied of alliedTokens) {
      // Skip the banner token itself — it shouldn't receive temp HP.
      if (allied.document.flags?.[GBToolbelt.MODULE_ID]?.[GBCommanderBanner.BANNER_TOKEN_FLAG]) continue;

      const dist = GBCommanderBanner.getDistanceFeet(originToken, allied);
      if (dist > GBCommanderBanner.BANNER_RANGE_FEET) continue;

      const { updated, prev, next } = await GBCommanderBanner.applyTempHP(allied.actor, tempHP);

      if (updated) {
        const change = prev > 0 ? `${prev} → ${next}` : `${next}`;
        lines.push(`<li><b>${allied.name}</b><br>has gained ${change} temp HP</li>`);
        ui.notifications.info(`${allied.name}: ${change} temp HP (Plant Banner)`);
      } else {
        const alreadyMsg = prev > tempHP
          ? `has more than ${tempHP} temp HP (${prev})`
          : `already has ${prev} temp HP`;
        lines.push(`<li><b>${allied.name}</b><br>${alreadyMsg}</li>`);
      }
    }

    if (lines.length === 0) lines.push('<li><em>No allies in range.</em></li>');

    ChatMessage.create({
      content: `<h3>⚑ Plant Banner — ${sourceLabel} (${tempHP} temp HP)</h3>`
        + `<ul style="margin:0.25em 0; padding-left:1.25em">${lines.join('')}</ul>`,
      whisper: ChatMessage.getWhisperRecipients('GM')
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Manually scan the scene for commanders and apply banner HP.
   * Respects the bannerHPChatCard setting and any planted banner tokens.
   * Useful outside of active combat (e.g. from a hotbar macro).
   */
  static async applyBannerHP() {
    if (!canvas.scene) return ui.notifications.warn('GBCommanderBanner | No active scene.');

    const commanderTokens = GBCommanderBanner.findBannerTokens();
    if (commanderTokens.length === 0) {
      return ui.notifications.warn(
        'No tokens with Commander class/archetype and Plant Banner found on this scene.'
      );
    }

    const useChatCard = game.settings.get(GBToolbelt.MODULE_ID, 'bannerHPChatCard');
    for (const commanderToken of commanderTokens) {
      const level       = commanderToken.actor.system.details.level.value;
      const tempHP      = GBCommanderBanner.calcTempHP(level);
      const bannerToken = GBCommanderBanner._findBannerTokenForCommander(commanderToken.actor.id);
      const originToken = bannerToken ?? commanderToken;
      const passCommander = bannerToken ? commanderToken : null;

      if (useChatCard) {
        await GBCommanderBanner._postChatCard(originToken, tempHP, passCommander);
      } else {
        await GBCommanderBanner._applyToAllies(originToken, tempHP, passCommander);
      }
    }
  }

  /**
   * Open a Portal crosshair to plant a Commander's Banner token on the scene.
   * If a banner is already deployed for this commander, offers to replace it.
   * Select your commander token on the canvas before calling, or pass it directly.
   * Requires the portal-lib module to be active.
   * @param {Token|null} commanderToken  Defaults to the first controlled canvas token.
   */
  static async placeBanner(commanderToken = null) {
    commanderToken ??= canvas.tokens.controlled[0] ?? null;

    if (!commanderToken) {
      ui.notifications.warn('GBCommanderBanner | Select your commander token before placing a banner.');
      return;
    }

    if (!GBCommanderBanner.isCommanderWithBanner(commanderToken.actor)) {
      ui.notifications.warn(`GBCommanderBanner | ${commanderToken.name} does not have Plant Banner.`);
      return;
    }

    // If a banner is already planted, offer to replace it.
    const existing = GBCommanderBanner._findBannerTokenForCommander(commanderToken.actor.id);
    if (existing) {
      const replace = await Dialog.confirm({
        title: 'Banner Already Planted',
        content: `<p>${commanderToken.name} already has a banner deployed. Replace it?</p>`
      });
      if (!replace) return;
      await GBCommanderBanner._cleanupBannerForCommander(commanderToken.actor.id);
    }

    const position = await GBCommanderBanner._showCrosshair(
      `Plant ${commanderToken.name}'s Banner`,
      GBCommanderBanner.BANNER_ICON
    );
    if (!position) return; // Cancelled

    const level  = commanderToken.actor.system.details.level.value;
    const tempHP = GBCommanderBanner.calcTempHP(level);

    if (game.user.isGM) {
      await GBCommanderBanner._createBannerTokenAndTemplate(
        commanderToken.id, position.x, position.y, tempHP
      );
    } else {
      // Non-GM: route creation through the GM via socket.
      game.socket.emit('module.greenbottles-toolbelt', {
        action: 'commanderBanner.place',
        commanderTokenId: commanderToken.id,
        x: position.x,
        y: position.y,
        tempHP
      });
    }
  }

  // ── Banner Token / Template ────────────────────────────────────────────────

  /**
   * Shows a Portal crosshair placement cursor and returns the grid-snapped
   * centre of the selected cell, or null if the user cancels.
   *
   * Uses portal-lib by theripper93 (CrossHairs.show static API).
   * If the API shape differs in your installed version, adjust here.
   * @param {string} label
   * @param {string} [iconUrl]
   * @returns {Promise<{x: number, y: number}|null>}
   */
  static async _showCrosshair(label, iconUrl) {
    const portal = game.modules.get('portal-lib');
    if (!portal?.active) {
      ui.notifications.error('GBCommanderBanner | Portal (portal-lib) is required for banner placement.');
      return null;
    }

    try {
      // portal-lib CrossHairs static API — https://github.com/theripper93/portal-lib
      const crosshairs = await portal.api.CrossHairs.show({
        size:        1,
        label,
        icon:        iconUrl,
        drawOutline: true,
        drawIcon:    !!iconUrl,
        fillColor:   0x2d7d32,
        fillAlpha:   0.15,
        strokeColor: 0x2d7d32
      });
      if (!crosshairs || crosshairs.cancelled) return null;
      return { x: crosshairs.x, y: crosshairs.y };
    } catch (err) {
      console.error('GBCommanderBanner | Portal crosshair error:', err);
      return null;
    }
  }

  /**
   * Ensures the "Commander's Banner" world actor exists; creates it if not.
   * Placed in a "Greenbottle's Toolbelt" folder and flagged for future lookup.
   * Called once on the GM's ready hook — safe to call multiple times.
   * @returns {Promise<Actor>}
   */
  static async _ensureBannerActor() {
    let actor = game.actors.find(a =>
      a.getFlag(GBToolbelt.MODULE_ID, GBCommanderBanner.BANNER_ACTOR_FLAG) === true
    );
    if (actor) return actor;

    let folder = game.folders.find(f =>
      f.name === GBCommanderBanner.BANNER_ACTOR_FOLDER && f.type === 'Actor'
    );
    if (!folder) {
      folder = await Folder.create({
        name:  GBCommanderBanner.BANNER_ACTOR_FOLDER,
        type:  'Actor',
        color: '#2d7d32',
        flags: { [GBToolbelt.MODULE_ID]: { moduleFolder: true } }
      });
    }

    actor = await Actor.create({
      name:   GBCommanderBanner.BANNER_ACTOR_NAME,
      type:   'npc',
      img:    GBCommanderBanner.BANNER_ICON,
      folder: folder.id,
      flags:  { [GBToolbelt.MODULE_ID]: { [GBCommanderBanner.BANNER_ACTOR_FLAG]: true } },
      prototypeToken: {
        name:        GBCommanderBanner.BANNER_ACTOR_NAME,
        width:       1,
        height:      1,
        disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        actorLink:   false,
        texture:     { src: GBCommanderBanner.BANNER_ICON }
      }
    });

    console.log("GBCommanderBanner | Created banner actor in world.");
    return actor;
  }

  /**
   * Places a banner token and a linked 30ft circle aura template on the scene.
   * Both are flagged so they can be found and cleaned up later.
   * @param {string} commanderTokenId
   * @param {number} x      Centre x in pixels (from Portal crosshair).
   * @param {number} y      Centre y in pixels (from Portal crosshair).
   * @param {number} tempHP
   */
  static async _createBannerTokenAndTemplate(commanderTokenId, x, y, tempHP) {
    const commanderToken = canvas.tokens.get(commanderTokenId);
    if (!commanderToken) {
      console.warn('GBCommanderBanner | Commander token not found for banner placement:', commanderTokenId);
      return;
    }

    const bannerActor = await GBCommanderBanner._ensureBannerActor();
    if (!bannerActor) return;

    const gs               = canvas.grid.size;
    const commanderActorId = commanderToken.actor.id;

    // Token x/y is the top-left corner; centre it on the crosshair position.
    const [tokenDoc] = await canvas.scene.createEmbeddedDocuments('Token', [{
      name:        `${commanderToken.name}'s Banner`,
      actorId:     bannerActor.id,
      actorLink:   false,
      x:           x - (gs / 2),
      y:           y - (gs / 2),
      width:       1,
      height:      1,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
      texture:     { src: GBCommanderBanner.BANNER_ICON },
      flags: {
        [GBToolbelt.MODULE_ID]: {
          [GBCommanderBanner.BANNER_TOKEN_FLAG]: true,
          commanderActorId,
          commanderTokenId,
          tempHP
        }
      }
    }]);

    // MeasuredTemplate x/y is the origin (centre for circles).
    await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [{
      t:           'circle',
      x,
      y,
      distance:    GBCommanderBanner.BANNER_RANGE_FEET,
      borderColor: '#2d7d32',
      fillColor:   '#2d7d32',
      fillAlpha:   0.05,
      flags: {
        [GBToolbelt.MODULE_ID]: {
          [GBCommanderBanner.BANNER_TEMPLATE_FLAG]: true,
          commanderActorId,
          bannerTokenId: tokenDoc.id
        }
      }
    }]);

    ui.notifications.info(`${commanderToken.name}'s banner has been planted.`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Called when combat is deleted (GM clicks End Combat).
   * Either auto-removes banner tokens or posts a GM cleanup card.
   */
  static _onCombatEnd() {
    if (!canvas.scene) return;

    const bannerTokens = canvas.tokens.placeables.filter(t =>
      t.document.flags?.[GBToolbelt.MODULE_ID]?.[GBCommanderBanner.BANNER_TOKEN_FLAG]
    );
    if (bannerTokens.length === 0) return;

    if (game.settings.get(GBToolbelt.MODULE_ID, 'bannerAutoCleanup')) {
      GBCommanderBanner._cleanupBannerTokens(bannerTokens);
    } else {
      GBCommanderBanner._postCleanupCard(bannerTokens);
    }
  }

  /**
   * Posts a GM-only chat card with a Retrieve button for post-combat cleanup.
   * @param {Token[]} bannerTokens
   */
  static async _postCleanupCard(bannerTokens) {
    const names  = bannerTokens.map(t => t.name).join(', ');
    const plural = bannerTokens.length > 1;

    await ChatMessage.create({
      content: `
        <div class="gb-banner-card">
          <h3>⚑ Combat Ended — Banner${plural ? 's' : ''} Deployed</h3>
          <p>${names} ${plural ? 'are' : 'is'} still planted on the field.</p>
          <button data-action="gb-retrieve-banners">
            Retrieve Banner${plural ? 's' : ''}
          </button>
        </div>`,
      whisper: ChatMessage.getWhisperRecipients('GM'),
      flags: { [GBToolbelt.MODULE_ID]: { cleanupCard: true } }
    });
  }

  /**
   * Deletes the given banner tokens and their linked aura templates from the scene.
   * @param {Token[]} bannerTokens
   */
  static async _cleanupBannerTokens(bannerTokens) {
    if (bannerTokens.length === 0) return;

    const bannerTokenIds = new Set(bannerTokens.map(t => t.id));

    // Remove the aura templates linked to these banner tokens.
    const templateIds = canvas.templates.placeables
      .filter(t => {
        const f = t.document.flags?.[GBToolbelt.MODULE_ID];
        return f?.[GBCommanderBanner.BANNER_TEMPLATE_FLAG] && bannerTokenIds.has(f.bannerTokenId);
      })
      .map(t => t.id);

    if (templateIds.length > 0) {
      await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate', templateIds);
    }
    await canvas.scene.deleteEmbeddedDocuments('Token', [...bannerTokenIds]);

    ui.notifications.info(`Banner${bannerTokens.length > 1 ? 's' : ''} retrieved.`);
  }

  /**
   * Deletes all banner tokens (and their templates) belonging to a specific commander.
   * @param {string} commanderActorId
   */
  static async _cleanupBannerForCommander(commanderActorId) {
    const tokens = canvas.tokens.placeables.filter(t => {
      const f = t.document.flags?.[GBToolbelt.MODULE_ID];
      return f?.[GBCommanderBanner.BANNER_TOKEN_FLAG] && f?.commanderActorId === commanderActorId;
    });
    await GBCommanderBanner._cleanupBannerTokens(tokens);
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

  /**
   * Returns the planted banner token for the given commander actor, or null.
   * @param {string} commanderActorId
   * @returns {Token|null}
   */
  static _findBannerTokenForCommander(commanderActorId) {
    return canvas.tokens.placeables.find(t => {
      const f = t.document.flags?.[GBToolbelt.MODULE_ID];
      return f?.[GBCommanderBanner.BANNER_TOKEN_FLAG] && f?.commanderActorId === commanderActorId;
    }) ?? null;
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
   * Grid-based distance in feet between two token centres.
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
