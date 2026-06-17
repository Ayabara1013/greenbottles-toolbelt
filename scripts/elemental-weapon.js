/**
 * GBElementalWeapon — Elemental Weapon focus spell automation for SF2e.
 *
 * Creates a real weapon item in the target's inventory when the spell is cast,
 * and automatically removes it when the spell effect expires or is dismissed.
 *
 * Usage from a macro or dependent module:
 *   const api = game.modules.get('greenbottles-toolbelt')?.api;
 *   await api.elementalWeapon.cast();
 */

class GBElementalWeapon {

  // ── Constants ──────────────────────────────────────────────────────────────

  /** Module ID — duplicated here since this file runs in its own module scope. */
  static MODULE_ID = 'greenbottles-toolbelt';

  /** Element → damage type mapping. */
  static ELEMENT_DAMAGE = {
    air:   { type: 'electricity', label: 'Electricity', icon: 'fa-bolt'       },
    earth: { type: 'bludgeoning', label: 'Bludgeoning', icon: 'fa-mountain'   },
    fire:  { type: 'fire',        label: 'Fire',        icon: 'fa-fire'       },
    metal: { type: 'acid',        label: 'Acid',        icon: 'fa-flask'      },
    water: { type: 'cold',        label: 'Cold',        icon: 'fa-droplet'    },
    wood:  { type: 'poison',      label: 'Poison',      icon: 'fa-seedling'   },
  };

  /**
   * Heightened spell rank → weapon grade and max item level.
   *
   * The spell allows the player to choose ANY weapon category (simple, martial,
   * or advanced) at every rank. What changes with heightening is the GRADE
   * (tactical → paragon), which determines the item level tier available.
   */
  static GRADE_BY_RANK = {
    1: { grade: 'tactical',  maxItemLevel: 1  },
    2: { grade: 'advanced',  maxItemLevel: 4  },
    5: { grade: 'superior',  maxItemLevel: 7  },
    6: { grade: 'elite',     maxItemLevel: 10 },
    8: { grade: 'ultimate',  maxItemLevel: 14 },
    9: { grade: 'paragon',   maxItemLevel: 20 },
  };

  /**
   * Pack ID patterns that identify Starfinder 2e content.
   * Weapons from packs not matching any of these will be excluded.
   */
  static SF2E_PACK_PATTERNS = [
    'sf2e', 'starfinder', 'anachronism',
  ];

  /** Flag keys used on actors and items. */
  static FLAG_KEY            = 'elementalWeapon';
  static FLAG_IS_EW          = 'isElementalWeapon';
  static FLAG_IS_EW_EFFECT   = 'isElementalWeaponEffect';

  /** Effect icon path. */
  static EFFECT_ICON = 'icons/magic/light/explosion-star-glow-silhouette.webp';

  /** Slugs / names to match in chat messages. */
  static SPELL_SLUGS = ['elemental-weapon'];
  static SPELL_NAMES = ['Elemental Weapon'];

  /** @type {object|null} socketlib socket handle. */
  static _socket = null;

  // ── Initialization ─────────────────────────────────────────────────────────

  static initialize() {
    GBElementalWeapon._registerSettings();

    // socketlib registration — returns the same handle for the same module ID.
    if (typeof socketlib !== 'undefined' && typeof socketlib.registerModule === 'function') {
      GBElementalWeapon._socket = socketlib.registerModule(GBElementalWeapon.MODULE_ID);
      GBElementalWeapon._socket.register('elementalWeapon.grant', data =>
        GBElementalWeapon._gmGrantWeapon(data)
      );
      GBElementalWeapon._socket.register('elementalWeapon.revoke', data =>
        GBElementalWeapon._gmRevokeWeapon(data)
      );
    }

    // Detect spell casts via PF2e chat messages.
    Hooks.on('createChatMessage', message => {
      GBElementalWeapon._onChatMessage(message);
    });

    // Inject "Apply Elemental Weapon" button into spell chat cards.
    Hooks.on('renderChatMessage', (message, html) => {
      GBElementalWeapon._onRenderSpellCard(message, html);
    });

    // Catch drops of our custom drag data onto actor sheets.
    Hooks.on('dropActorSheetData', (actor, _sheet, data) => {
      if (data.type !== 'GBElementalWeapon') return;
      GBElementalWeapon.cast({
        spellLevel: data.spellLevel ?? 1,
        caster: data.casterActorId ? game.actors.get(data.casterActorId) : undefined,
        target: actor,
      });
      return false; // prevent default drop handling
    });

    // Also catch drops onto canvas tokens (in case player drops on a token directly).
    Hooks.on('dropCanvasData', (_canvas, data) => {
      if (data.type !== 'GBElementalWeapon') return;
      // Find a token at the drop position.
      const token = canvas.tokens.placeables.find(t =>
        t.bounds?.contains(data.x, data.y) ?? false
      );
      if (!token?.actor) {
        ui.notifications.warn('Elemental Weapon | Drop onto a token or character sheet.');
        return;
      }
      GBElementalWeapon.cast({
        spellLevel: data.spellLevel ?? 1,
        caster: data.casterActorId ? game.actors.get(data.casterActorId) : undefined,
        target: token.actor,
      });
      return false;
    });

    // Cleanup hooks — only run on the GM client to avoid duplicate deletions.
    Hooks.on('deleteItem', (item, _options, _userId) => {
      if (!game.user.isGM) return;
      GBElementalWeapon._onItemDeleted(item);
    });

    console.log("Greenbottle's Toolbelt | Elemental Weapon initialized");
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  static _registerSettings() {
    // Stub for future feature: include PF2e weapons in the weapon list.
    game.settings.register(GBElementalWeapon.MODULE_ID, 'elementalWeaponIncludePF2e', {
      name: 'Elemental Weapon — Include PF2e Weapons (TBI)',
      hint: 'When enabled, PF2e weapons will also appear in the weapon selection list. Not yet implemented.',
      scope: 'world',
      config: false,  // hidden until implemented
      type: Boolean,
      default: false,
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Main entry point. Cast Elemental Weapon on a target.
   *
   * @param {object} [options]
   * @param {number} [options.spellLevel=1]  Heightened spell rank.
   * @param {Actor}  [options.caster]        Caster actor. Defaults to selected token's actor.
   * @param {Actor}  [options.target]        Target actor. Defaults to first targeted token's actor.
   */
  static async cast({ spellLevel = 1, caster, target } = {}) {
    // Resolve caster from selected token if not provided.
    if (!caster) {
      const selectedToken = canvas.tokens.controlled[0];
      if (!selectedToken) {
        ui.notifications.warn('Elemental Weapon | Select a token as the caster.');
        return;
      }
      caster = selectedToken.actor;
    }

    // Resolve target from targeted tokens if not provided.
    if (!target) {
      const targets = game.user.targets;
      if (targets.size === 0) {
        ui.notifications.warn('Elemental Weapon | Target a token to receive the weapon.');
        return;
      }
      target = targets.first().actor;
    }

    // Check for existing elemental weapon on target.
    const existingFlag = target.getFlag(GBElementalWeapon.MODULE_ID, GBElementalWeapon.FLAG_KEY);
    if (existingFlag) {
      const confirm = await Dialog.confirm({
        title: 'Elemental Weapon',
        content: `<p>${target.name} already has an Elemental Weapon. Replace it?</p>`,
        defaultYes: false,
      });
      if (!confirm) return;
      await GBElementalWeapon._revokeWeapon(target);
    }

    // Step 1: Choose element.
    const element = await GBElementalWeapon._promptElement();
    if (!element) return; // cancelled

    // Step 2: Resolve weapon grade from spell rank.
    const { grade, maxItemLevel } = GBElementalWeapon._resolveGrade(spellLevel);

    // Step 3: Choose base weapon from compendiums.
    // All categories (simple, martial, advanced) are allowed at every rank.
    const baseWeapon = await GBElementalWeapon._promptWeapon(maxItemLevel);
    if (!baseWeapon) return; // cancelled

    // Step 4: Build the modified weapon data.
    const weaponData = GBElementalWeapon._buildWeaponData(baseWeapon, element, grade);

    // Step 5: Grant weapon + effect to target.
    if (game.user.isGM) {
      await GBElementalWeapon._grantWeapon(target, weaponData, {
        casterActorId: caster.id,
        element,
        spellLevel,
      });
    } else if (GBElementalWeapon._socket) {
      await GBElementalWeapon._socket.executeAsGM('elementalWeapon.grant', {
        targetActorId: target.id,
        weaponData,
        metadata: { casterActorId: caster.id, element, spellLevel },
      });
    } else {
      ui.notifications.error('Elemental Weapon | socketlib is required for non-GM casting.');
      return;
    }

    ui.notifications.info(`Elemental Weapon | ${target.name} receives a ${element} weapon!`);
  }

  // ── Element Prompt ─────────────────────────────────────────────────────────

  /**
   * Prompt the player to select an element using a ChoiceSet-style grid dialog.
   * @returns {Promise<string|null>} Element key or null if cancelled.
   */
  static _promptElement() {
    const elements = Object.entries(GBElementalWeapon.ELEMENT_DAMAGE);

    const content = `
      <p style="margin-bottom: 8px;"><strong>Select an elemental trait for the weapon:</strong></p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
        ${elements.map(([key, { label, icon }]) => `
          <button type="button" class="gb-ew-element-btn" data-element="${key}"
                  style="display: flex; align-items: center; gap: 6px; padding: 6px 10px;
                         border: 1px solid #999; border-radius: 4px; cursor: pointer;
                         background: #f0f0f0;">
            <i class="fas ${icon}"></i> ${key.charAt(0).toUpperCase() + key.slice(1)}
            <span style="color: #666; font-size: 0.85em;">(${label})</span>
          </button>
        `).join('')}
      </div>
    `;

    return new Promise(resolve => {
      let resolved = false;
      const dlg = new Dialog({
        title: 'Elemental Weapon — Choose Element',
        content,
        buttons: {},
        render: html => {
          // Foundry v13 may pass a vanilla DOM element or jQuery — handle both.
          const el = html instanceof HTMLElement ? html
            : html?.[0] instanceof HTMLElement ? html[0]
            : html?.element instanceof HTMLElement ? html.element
            : null;
          if (!el) {
            console.warn('GBElementalWeapon | Could not resolve dialog HTML element:', html);
            return;
          }
          el.querySelectorAll('.gb-ew-element-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              if (resolved) return;
              resolved = true;
              resolve(btn.dataset.element);
              dlg.close();
            });
          });
        },
        close: () => { if (!resolved) { resolved = true; resolve(null); } },
      }, { width: 340 });
      dlg.render(true);
    });
  }

  // ── Weapon Selection ───────────────────────────────────────────────────────

  /**
   * Query compendiums for weapons matching the item level tier,
   * then present a filterable selection dialog.
   *
   * @param {number} maxItemLevel  Maximum item level for this grade.
   * @returns {Promise<object|null>} Weapon item data or null if cancelled.
   */
  static async _promptWeapon(maxItemLevel) {
    const weapons = await GBElementalWeapon._queryWeapons(maxItemLevel);

    if (weapons.length === 0) {
      ui.notifications.warn(`Elemental Weapon | No weapons (level 0–${maxItemLevel}) found in SF2e compendiums.`);
      return null;
    }

    return GBElementalWeapon._showWeaponDialog(weapons);
  }

  /**
   * Check if a compendium pack contains Starfinder 2e content.
   * @param {CompendiumCollection} pack
   * @returns {boolean}
   */
  static _isSF2ePack(pack) {
    const id = (pack.metadata.id ?? '').toLowerCase();
    const packageName = (pack.metadata.packageName ?? pack.metadata.package ?? '').toLowerCase();
    const label = (pack.metadata.label ?? '').toLowerCase();
    const combined = `${id} ${packageName} ${label}`;
    return GBElementalWeapon.SF2E_PACK_PATTERNS.some(p => combined.includes(p));
  }

  /**
   * Search game compendiums for SF2e weapons up to the given item level.
   * All weapon categories (simple, martial, advanced) are included.
   * Excludes unique weapons.
   *
   * @param {number} maxItemLevel  Maximum item level for this grade.
   * @returns {Promise<object[]>}  Array of weapon item data objects.
   */
  static async _queryWeapons(maxItemLevel) {
    const matchingUuids = [];

    for (const pack of game.packs) {
      if (pack.metadata.type !== 'Item') continue;

      const isSF2e = GBElementalWeapon._isSF2ePack(pack);

      // Only index packs that might contain weapons (skip non-SF2e for now).
      const index = await pack.getIndex({
        fields: ['system.category', 'system.level', 'system.traits', 'system.damage', 'system.range'],
      });

      // Debug: log pack info to help identify SF2e packs.
      const firstWeapon = index.find(e => e.type === 'weapon');
      if (firstWeapon) {
        console.log(`GBElementalWeapon | Pack "${pack.metadata.label}" `
          + `(${pack.metadata.packageName ?? pack.metadata.package ?? '?'}) `
          + `SF2e=${isSF2e} | sample: "${firstWeapon.name}" system:`,
          JSON.stringify(firstWeapon.system));
      }

      if (!isSF2e) continue;

      for (const entry of index) {
        if (entry.type !== 'weapon') continue;

        // Filter by item level.
        const itemLevel = entry.system?.level?.value ?? entry.system?.level ?? 0;
        if (typeof maxItemLevel === 'number' && itemLevel > maxItemLevel) continue;

        // Exclude unique weapons.
        const rarity = entry.system?.traits?.rarity ?? '';
        if (rarity === 'unique') continue;

        matchingUuids.push(entry.uuid);
      }
    }

    console.log(`GBElementalWeapon | Found ${matchingUuids.length} matching SF2e weapons (maxLevel: ${maxItemLevel})`);

    // Batch-load the matching weapons.
    const weapons = [];
    for (const uuid of matchingUuids) {
      try {
        const doc = await fromUuid(uuid);
        if (doc) weapons.push(doc.toObject());
      } catch (err) {
        console.warn(`GBElementalWeapon | Failed to load weapon ${uuid}:`, err);
      }
    }

    // Sort alphabetically by name.
    weapons.sort((a, b) => a.name.localeCompare(b.name));
    return weapons;
  }

  /**
   * Show a filterable weapon selection dialog.
   *
   * @param {object[]} weapons  Array of weapon item data objects.
   * @returns {Promise<object|null>} Selected weapon data or null.
   */
  static _showWeaponDialog(weapons) {
    // Determine if each weapon is melee or ranged.
    const categorize = w => {
      if (w.system?.range && w.system.range > 0) return 'ranged';
      return 'melee';
    };

    const buildList = (filtered) => filtered.map(w => {
      const dmg = w.system?.damage;
      const dmgStr = dmg ? `${dmg.dice ?? 1}${dmg.die ?? 'd4'} ${dmg.damageType ?? ''}` : '';
      const traits = (w.system?.traits?.value ?? []).join(', ');
      const cat = categorize(w);
      const category = w.system?.category ?? '?';
      const level = w.system?.level?.value ?? w.system?.level ?? '?';
      return `<div class="gb-ew-weapon-entry" data-weapon-id="${w._id}" data-weapon-name="${w.name}"
                   data-category="${cat}" data-traits="${(w.system?.traits?.value ?? []).join(',')}"
                   style="display: flex; justify-content: space-between; align-items: center;
                          padding: 6px 8px; border-bottom: 1px solid #ddd; cursor: pointer;"
                   title="${traits}">
                <span style="font-weight: 500;">${w.name}</span>
                <span style="color: #666; font-size: 0.85em;">Lv${level} ${category} | ${dmgStr} | ${cat}</span>
              </div>`;
    }).join('');

    const content = `
      <div class="gb-ew-weapon-picker">
        <div style="display: flex; gap: 4px; margin-bottom: 8px;">
          <button type="button" class="gb-ew-filter-btn active" data-filter="all"
                  style="padding: 3px 10px; border-radius: 12px; border: 1px solid #666;
                         background: #4b4a44; color: #fff; cursor: pointer; font-size: 0.85em;">
            All
          </button>
          <button type="button" class="gb-ew-filter-btn" data-filter="melee"
                  style="padding: 3px 10px; border-radius: 12px; border: 1px solid #666;
                         background: #f0f0f0; cursor: pointer; font-size: 0.85em;">
            Melee
          </button>
          <button type="button" class="gb-ew-filter-btn" data-filter="ranged"
                  style="padding: 3px 10px; border-radius: 12px; border: 1px solid #666;
                         background: #f0f0f0; cursor: pointer; font-size: 0.85em;">
            Ranged
          </button>
        </div>
        <input type="text" class="gb-ew-search" placeholder="Search weapons..."
               style="width: 100%; margin-bottom: 8px; padding: 4px 8px; border: 1px solid #999;
                      border-radius: 4px;" />
        <div class="gb-ew-weapon-list" style="max-height: 350px; overflow-y: auto;
                    border: 1px solid #ccc; border-radius: 4px;">
          ${buildList(weapons)}
        </div>
      </div>
    `;

    return new Promise(resolve => {
      let selectedWeapon = null;

      const dlg = new Dialog({
        title: 'Elemental Weapon — Choose Weapon',
        content,
        buttons: {
          select: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Select',
            callback: () => selectedWeapon,
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => null,
          },
        },
        default: 'select',
        render: html => {
          // Foundry v13 may pass vanilla DOM or jQuery — handle both.
          const root = html instanceof HTMLElement ? html
            : html?.[0] instanceof HTMLElement ? html[0]
            : html?.element instanceof HTMLElement ? html.element
            : null;
          if (!root) {
            console.warn('GBElementalWeapon | Could not resolve weapon dialog HTML element');
            return;
          }

          const listEl = root.querySelector('.gb-ew-weapon-list');
          const searchEl = root.querySelector('.gb-ew-search');
          const filterBtns = root.querySelectorAll('.gb-ew-filter-btn');
          let activeFilter = 'all';

          const applyFilters = () => {
            const searchTerm = (searchEl?.value ?? '').toLowerCase();
            listEl?.querySelectorAll('.gb-ew-weapon-entry').forEach(entry => {
              const cat = entry.dataset.category;
              const name = entry.dataset.weaponName?.toLowerCase() ?? '';
              const matchesCategory = activeFilter === 'all' || cat === activeFilter;
              const matchesSearch = name.includes(searchTerm);
              entry.style.display = (matchesCategory && matchesSearch) ? '' : 'none';
            });
          };

          // Filter chip buttons.
          filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
              filterBtns.forEach(b => {
                b.style.background = '#f0f0f0';
                b.style.color = '#000';
                b.classList.remove('active');
              });
              btn.style.background = '#4b4a44';
              btn.style.color = '#fff';
              btn.classList.add('active');
              activeFilter = btn.dataset.filter;
              applyFilters();
            });
          });

          // Search input.
          searchEl?.addEventListener('input', applyFilters);

          // Weapon selection — highlight on click.
          listEl?.addEventListener('click', ev => {
            const entry = ev.target.closest('.gb-ew-weapon-entry');
            if (!entry) return;
            listEl.querySelectorAll('.gb-ew-weapon-entry').forEach(e => e.style.background = '');
            entry.style.background = '#d4edda';
            const weaponName = entry.dataset.weaponName;
            selectedWeapon = weapons.find(w => w.name === weaponName) ?? null;
          });
        },
        close: () => resolve(selectedWeapon),
      }, { width: 440, height: 520 });
      dlg.render(true);
    });
  }

  // ── Grade Resolution ───────────────────────────────────────────────────────

  /**
   * Map a heightened spell rank to the weapon grade and max item level.
   * Uses the highest defined rank at or below the given spell rank.
   *
   * @param {number} spellRank
   * @returns {{ grade: string, maxItemLevel: number }}
   */
  static _resolveGrade(spellRank) {
    const ranks = Object.keys(GBElementalWeapon.GRADE_BY_RANK)
      .map(Number)
      .sort((a, b) => b - a);

    for (const r of ranks) {
      if (spellRank >= r) return GBElementalWeapon.GRADE_BY_RANK[r];
    }
    // Fallback to base.
    return GBElementalWeapon.GRADE_BY_RANK[1];
  }

  // ── Weapon Data Builder ────────────────────────────────────────────────────

  /**
   * Clone a base weapon and modify it for Elemental Weapon.
   * - Adds 1d4 elemental damage via DamageDice rule element.
   * - Reduces upgrade slots by 1.
   * - Sets ammo to unlimited.
   * - Sets weapon to held/wielded so it appears in Attacks.
   * - Sets identifying flags.
   *
   * @param {object} baseWeapon  Weapon item data object (from compendium).
   * @param {string} element     Element key (air, earth, fire, metal, water, wood).
   * @param {string} grade       Weapon grade string.
   * @returns {object} Modified weapon item data ready for createEmbeddedDocuments.
   */
  static _buildWeaponData(baseWeapon, element, grade) {
    const data = foundry.utils.deepClone(baseWeapon);
    const elementInfo = GBElementalWeapon.ELEMENT_DAMAGE[element];
    const elementName = element.charAt(0).toUpperCase() + element.slice(1);

    // ── Clean compendium references ──
    delete data._id;
    delete data._stats;
    if (data.flags?.core?.sourceId) delete data.flags.core.sourceId;

    // ── Rename ──
    data.name = `${data.name} (Elemental — ${elementName})`;

    // ── Module flags ──
    foundry.utils.setProperty(data, `flags.${GBElementalWeapon.MODULE_ID}.${GBElementalWeapon.FLAG_IS_EW}`, true);
    foundry.utils.setProperty(data, `flags.${GBElementalWeapon.MODULE_ID}.elementalWeaponElement`, element);
    foundry.utils.setProperty(data, `flags.${GBElementalWeapon.MODULE_ID}.elementalWeaponGrade`, grade);

    // ── Add 1d4 elemental damage via DamageDice rule element ──
    // DamageDice is the correct RE for adding bonus damage dice in PF2e.
    if (!data.system.rules) data.system.rules = [];
    data.system.rules.push({
      key: 'DamageDice',
      selector: '{item|_id}-damage',
      diceNumber: 1,
      dieSize: 'd4',
      damageType: elementInfo.type,
      label: `Elemental Weapon (${elementInfo.label})`,
    });

    // ── Add element as a trait ──
    if (!data.system.traits) data.system.traits = { value: [] };
    if (!data.system.traits.value.includes(element)) {
      data.system.traits.value.push(element);
    }

    // ── Reduce upgrade slots by 1 (SF2e specific) ──
    // Try known property paths for upgrade slots.
    if (typeof data.system?.upgradeSlots === 'number') {
      data.system.upgradeSlots = Math.max(0, data.system.upgradeSlots - 1);
    } else if (typeof data.system?.slots === 'number') {
      data.system.slots = Math.max(0, data.system.slots - 1);
    }
    foundry.utils.setProperty(data, `flags.${GBElementalWeapon.MODULE_ID}.upgradeSlotReduced`, true);

    // ── Set ammo to unlimited ──
    // PF2e/SF2e weapons may track ammo via system.usage or system.ammunition.
    // Set magazine/charges to a high value and mark as unlimited.
    if (data.system?.ammunition) {
      // If the weapon has ammunition tracking, clear it so it doesn't consume ammo.
      data.system.ammunition = {};
    }
    // For SF2e weapons with magazine systems, set to not require reloading.
    if (data.system?.reload) {
      data.system.reload = { value: '' };
    }
    // Flag so we can identify this was set.
    foundry.utils.setProperty(data, `flags.${GBElementalWeapon.MODULE_ID}.unlimitedAmmo`, true);

    // ── Set weapon to equipped/held ──
    // In PF2e, weapons need to be in a "held" carrying state to show in Attacks.
    // The carryType 'held' with handsHeld 1 (or 2 for two-handed) makes it wielded.
    const isTwoHanded = (data.system?.traits?.value ?? []).some(t =>
      t === 'two-hand' || t.startsWith('two-hand-')
    );
    foundry.utils.setProperty(data, 'system.equipped.carryType', 'held');
    foundry.utils.setProperty(data, 'system.equipped.handsHeld', isTwoHanded ? 2 : 1);
    // Also try the older invest/equip path.
    foundry.utils.setProperty(data, 'system.equipped.value', true);

    // ── Update description ──
    const note = `<hr/><p><em>Elemental Weapon (${elementName})</em> — ` +
      `This weapon deals an additional 1d4 ${elementInfo.label.toLowerCase()} damage. ` +
      `It has one fewer upgrade slot than normal and cannot be made of special materials. ` +
      `It can be upgraded with upgrades held in the caster's hands as a locus. ` +
      `It comes fully charged and loaded with unlimited basic ammunition.</p>`;
    // PF2e stores description as { value: string }.
    if (typeof data.system.description === 'object' && data.system.description !== null) {
      data.system.description.value = (data.system.description.value ?? '') + note;
    } else {
      data.system.description = { value: (data.system.description ?? '') + note };
    }

    return data;
  }

  // ── Grant & Revoke ─────────────────────────────────────────────────────────

  /**
   * Create the Elemental Weapon effect and weapon on the target actor.
   *
   * @param {Actor}  target      Target actor.
   * @param {object} weaponData  Modified weapon item data.
   * @param {object} metadata    { casterActorId, element, spellLevel }
   */
  static async _grantWeapon(target, weaponData, metadata) {
    // Create the effect first (10-minute duration).
    const elementName = metadata.element.charAt(0).toUpperCase() + metadata.element.slice(1);
    const effectData = {
      type: 'effect',
      name: 'Effect: Elemental Weapon',
      img: GBElementalWeapon.EFFECT_ICON,
      system: {
        tokenIcon: { show: true },
        duration: {
          value: 10,
          unit: 'minutes',
          sustained: false,
          expiry: 'turn-start',
        },
        description: {
          value: `<p>A weapon of elemental ${elementName} energy materializes in your hands.</p>`,
        },
        rules: [],
      },
      flags: {
        [GBElementalWeapon.MODULE_ID]: {
          [GBElementalWeapon.FLAG_IS_EW_EFFECT]: true,
          ...metadata,
        },
      },
    };

    const [effect] = await target.createEmbeddedDocuments('Item', [effectData]);

    // Now create the weapon, linking it to the effect.
    foundry.utils.setProperty(weaponData,
      `flags.${GBElementalWeapon.MODULE_ID}.linkedEffectId`, effect.id
    );
    const [weapon] = await target.createEmbeddedDocuments('Item', [weaponData]);

    // Store the association on the actor for easy lookup.
    await target.setFlag(GBElementalWeapon.MODULE_ID, GBElementalWeapon.FLAG_KEY, {
      weaponItemId: weapon.id,
      effectItemId: effect.id,
      casterActorId: metadata.casterActorId,
      element: metadata.element,
      spellLevel: metadata.spellLevel,
    });

    // Also store the weapon ID on the effect for reverse lookup.
    await effect.setFlag(GBElementalWeapon.MODULE_ID, 'linkedWeaponId', weapon.id);

    console.log(`GBElementalWeapon | Granted ${weapon.name} to ${target.name} (effect: ${effect.id})`);
  }

  /**
   * Remove the Elemental Weapon and its effect from the target actor.
   *
   * @param {Actor} target
   */
  static async _revokeWeapon(target) {
    const flagData = target.getFlag(GBElementalWeapon.MODULE_ID, GBElementalWeapon.FLAG_KEY);
    if (!flagData) return;

    const idsToDelete = [];
    if (flagData.weaponItemId && target.items.get(flagData.weaponItemId)) {
      idsToDelete.push(flagData.weaponItemId);
    }
    if (flagData.effectItemId && target.items.get(flagData.effectItemId)) {
      idsToDelete.push(flagData.effectItemId);
    }

    if (idsToDelete.length > 0) {
      await target.deleteEmbeddedDocuments('Item', idsToDelete);
    }

    await target.unsetFlag(GBElementalWeapon.MODULE_ID, GBElementalWeapon.FLAG_KEY);
    console.log(`GBElementalWeapon | Revoked elemental weapon from ${target.name}`);
  }

  // ── GM Socket Handlers ─────────────────────────────────────────────────────

  static async _gmGrantWeapon({ targetActorId, weaponData, metadata }) {
    const target = game.actors.get(targetActorId);
    if (!target) {
      console.error(`GBElementalWeapon | Target actor ${targetActorId} not found.`);
      return;
    }
    await GBElementalWeapon._grantWeapon(target, weaponData, metadata);
  }

  static async _gmRevokeWeapon({ targetActorId }) {
    const target = game.actors.get(targetActorId);
    if (!target) return;
    await GBElementalWeapon._revokeWeapon(target);
  }

  // ── Spell Chat Card Injection ──────────────────────────────────────────────

  /**
   * Hook handler for renderChatMessage. Injects a draggable "Apply Elemental
   * Weapon" button into the spell card so the caster can drag it onto a player
   * (or click it with a target selected) even without a target at cast time.
   *
   * @param {ChatMessage} message
   * @param {HTMLElement|jQuery} html
   */
  static _onRenderSpellCard(message, html) {
    // Identify the HTML root (v13 may pass vanilla DOM or jQuery).
    const root = html instanceof HTMLElement ? html
      : html?.[0] instanceof HTMLElement ? html[0]
      : html?.element instanceof HTMLElement ? html.element
      : null;
    if (!root) return;

    // Only act on Elemental Weapon spell cards.
    const origin = message.flags?.pf2e?.origin;
    if (!origin) return;

    const isEWCard = (() => {
      // Fast path: check content for the spell name.
      const content = root.textContent ?? '';
      if (!content.includes('Elemental Weapon')) return false;
      // Confirm it's a spell card, not just any chat message.
      return origin.type === 'spell'
        || message.flags?.pf2e?.context?.type === 'spell-cast'
        || root.querySelector('[data-spell-lvl], .spell-header, .spell-traits') !== null;
    })();
    if (!isEWCard) return;

    // Don't inject more than once (renderChatMessage fires on every re-render).
    if (root.querySelector('.gb-ew-apply-btn')) return;

    const spellLevel = origin.castRank ?? origin.castLevel ?? 1;
    const casterActorId = message.speaker?.actor ?? '';

    // Build the button — styled like PF2e's own "Spell Effect" links.
    const btn = document.createElement('a');
    btn.className = 'gb-ew-apply-btn';
    btn.draggable = true;
    btn.title = 'Drag onto a character sheet, or click with a token targeted';
    btn.innerHTML = '<i class="fas fa-wand-sparkles"></i> Apply Elemental Weapon';
    btn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'gap: 4px',
      'padding: 2px 8px',
      'margin-top: 4px',
      'border: 1px solid #7a7971',
      'border-radius: 3px',
      'background: rgba(0,0,0,0.1)',
      'cursor: grab',
      'font-size: 0.85em',
      'text-decoration: none',
    ].join('; ');

    // Drag: encode our custom data so dropActorSheetData can pick it up.
    btn.addEventListener('dragstart', ev => {
      ev.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'GBElementalWeapon',
        spellLevel,
        casterActorId,
      }));
      // Also set as a Foundry-style drag so the drop hook fires correctly.
      ev.dataTransfer.setData('application/json', JSON.stringify({
        type: 'GBElementalWeapon',
        spellLevel,
        casterActorId,
      }));
    });

    // Click: apply to currently targeted token (same as cast-time flow).
    btn.addEventListener('click', async ev => {
      ev.preventDefault();
      const targets = game.user.targets;
      if (targets.size === 0) {
        ui.notifications.warn('Elemental Weapon | Target a token first, then click Apply.');
        return;
      }
      await GBElementalWeapon.cast({
        spellLevel,
        caster: casterActorId ? game.actors.get(casterActorId) : undefined,
        target: targets.first().actor,
      });
    });

    // Find the best insertion point: after card description, or at the end.
    const cardDesc = root.querySelector('.card-content, .message-content, section.content');
    const container = document.createElement('div');
    container.style.cssText = 'padding: 4px 8px 6px;';
    container.appendChild(btn);

    if (cardDesc) {
      cardDesc.after(container);
    } else {
      root.appendChild(container);
    }
  }

  // ── Spell Cast Detection ───────────────────────────────────────────────────

  /**
   * Hook handler for createChatMessage. Detects when Elemental Weapon is cast
   * via the PF2e spell UI and triggers the automation.
   *
   * @param {ChatMessage} message
   */
  static async _onChatMessage(message) {
    // Only trigger for the user who created the message (the caster).
    if (message.author?.id !== game.user.id) return;

    // Check PF2e origin flags for spell identification.
    const origin = message.flags?.pf2e?.origin;
    if (!origin) return;

    // Try to resolve the origin item to check if it's Elemental Weapon.
    let isElementalWeapon = false;
    let spellLevel = origin.castRank ?? origin.castLevel ?? 1;

    // Check by UUID — resolve the origin item.
    if (origin.uuid) {
      try {
        const item = await fromUuid(origin.uuid);
        if (item) {
          const slug = item.system?.slug ?? item.slug ?? '';
          const name = item.name ?? '';
          isElementalWeapon =
            GBElementalWeapon.SPELL_SLUGS.includes(slug) ||
            GBElementalWeapon.SPELL_NAMES.includes(name);
          if (!spellLevel) spellLevel = item.system?.level?.value ?? 1;
        }
      } catch {
        // UUID resolution failed — fall back to name check below.
      }
    }

    // Fallback: check the chat message content for the spell name.
    if (!isElementalWeapon) {
      const content = message.content ?? '';
      if (content.includes('Elemental Weapon')) {
        const isSpellCard = origin.type === 'spell' ||
          message.flags?.pf2e?.context?.type === 'spell-cast' ||
          content.includes('data-pf2-action') ||
          content.includes('spell-card');
        isElementalWeapon = isSpellCard;
      }
    }

    if (!isElementalWeapon) return;

    console.log(`GBElementalWeapon | Detected Elemental Weapon cast (rank ${spellLevel})`);

    // Resolve caster from the message speaker.
    const caster = game.actors.get(message.speaker?.actor);
    if (!caster) {
      console.warn('GBElementalWeapon | Could not resolve caster from chat message.');
      return;
    }

    // Resolve target from the user's current targets.
    const targets = game.user.targets;
    if (targets.size === 0) {
      ui.notifications.warn('Elemental Weapon | Target a token to receive the weapon.');
      return;
    }
    const target = targets.first().actor;

    // Trigger the full cast flow.
    await GBElementalWeapon.cast({ spellLevel, caster, target });
  }

  // ── Cleanup Hooks ──────────────────────────────────────────────────────────

  /**
   * Hook handler for deleteItem. Handles both directions:
   * - Effect deleted → remove weapon
   * - Weapon deleted → remove effect
   *
   * @param {Item} item  The deleted item.
   */
  static async _onItemDeleted(item) {
    const actor = item.actor;
    if (!actor) return;

    const flags = item.flags?.[GBElementalWeapon.MODULE_ID];
    if (!flags) return;

    // Case 1: The Elemental Weapon effect was deleted (expired or manual).
    if (flags[GBElementalWeapon.FLAG_IS_EW_EFFECT]) {
      const weaponId = flags.linkedWeaponId;
      if (weaponId && actor.items.get(weaponId)) {
        await actor.deleteEmbeddedDocuments('Item', [weaponId]);
      }
      await actor.unsetFlag(GBElementalWeapon.MODULE_ID, GBElementalWeapon.FLAG_KEY);
      console.log(`GBElementalWeapon | Effect expired/deleted — removed weapon from ${actor.name}`);
      return;
    }

    // Case 2: The weapon itself was manually deleted.
    if (flags[GBElementalWeapon.FLAG_IS_EW]) {
      const effectId = flags.linkedEffectId;
      if (effectId && actor.items.get(effectId)) {
        await actor.deleteEmbeddedDocuments('Item', [effectId]);
      }
      await actor.unsetFlag(GBElementalWeapon.MODULE_ID, GBElementalWeapon.FLAG_KEY);
      console.log(`GBElementalWeapon | Weapon deleted — removed effect from ${actor.name}`);
    }
  }
}


// ── Entry point ──────────────────────────────────────────────────────────────
// Self-registering: this file runs in its own module scope, so we initialize
// via our own init hook (runs after toolbelt.js's init hook since this file
// is listed second in module.json's esmodules array).

Hooks.once('init', () => {
  const module = game.modules.get(GBElementalWeapon.MODULE_ID);
  if (module?.api) {
    module.api.elementalWeapon = GBElementalWeapon;
  }
  GBElementalWeapon.initialize();
});
