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

// ── Entry point ──────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  const module = game.modules.get(GBToolbelt.MODULE_ID);
  if (module) module.api = GBToolbelt;
  GBToolbelt.initialize();
});
