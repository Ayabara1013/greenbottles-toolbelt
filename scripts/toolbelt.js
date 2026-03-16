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
    Hooks.on('getSceneControlButtons', controls => GBHeroPoints._addToolbarButton(controls));
    console.log("Greenbottle's Toolbelt | Hero Points initialized");
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


// ── Entry point ──────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  const module = game.modules.get(GBToolbelt.MODULE_ID);
  if (module) module.api = GBToolbelt;
  GBToolbelt.initialize();
  GBHeroPoints.initialize();
});
