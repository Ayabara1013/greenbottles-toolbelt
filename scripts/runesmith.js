/**
 * GBRunesmith — Extempore rune inscription automation for SF2e.
 *
 * Reads the Runesmith's rune items from their inventory. Base runes and
 * diacritics (trait: 'diacritic') are shown separately. When a diacritic
 * is paired with a base rune, a single combined effect is created whose
 * rule elements merge both the base rune and the diacritic's contribution.
 *
 * Usage from a macro or dependent module:
 *   const api = game.modules.get('greenbottles-toolbelt')?.api;
 *   await api.runesmith.manageRunes();   // toggle UI (primary)
 *   await api.runesmith.placeRune();     // single-pick flow (programmatic)
 */

class GBRunesmith {

  // ── Constants ──────────────────────────────────────────────────────────────

  static MODULE_ID = 'greenbottles-toolbelt';

  /**
   * SF2e traits that identify an item as a rune.
   * Extend if your system uses different trait names.
   */
  static RUNE_TRAITS = ['rune', 'inscription'];

  /** Fallback: include items whose name contains this pattern. */
  static RUNE_NAME_PATTERN = /rune/i;

  /**
   * Only physical inventory items are candidates for runes.
   * This excludes class features, actions, feats, effects, etc. that
   * happen to have "rune" in their name or traits (e.g. the Runesmith
   * class item, Trace Rune action, Invoke Rune action).
   */
  static PHYSICAL_ITEM_TYPES = new Set([
    'equipment', 'weapon', 'armor', 'shield', 'consumable', 'treasure', 'backpack',
  ]);

  /** Duration in minutes for an extempore rune effect. */
  static EFFECT_DURATION_MINUTES = 1;

  /** Actor flag key storing the map of active extempore rune entries. */
  static FLAG_RUNES = 'activeRunes';

  /** Flag key on the effect item used to identify it as an extempore rune. */
  static FLAG_IS_RUNE_EFFECT = 'isRuneEffect';

  /**
   * Rule element contributors for known diacritic types.
   * Keyed by a lowercase string that must appear in the item's slug or name.
   * Each value is a function (casterActor) => RuleElement[].
   *
   * Add entries here for new diacritics as the Runesmith learns them.
   */
  static DIACRITIC_EFFECTS = {
    'intensity':   () => [],   // bonus is in DIACRITIC_INVOCATION, not a target rule element
    'preservation': () => [],  // behavioral only; no rule elements
  };

  /**
   * Diacritics whose name/slug matches one of these strings may only be
   * paired with ONE base rune at a time (Sun- restriction).
   */
  static DIACRITIC_EXCLUSIVE = ['preservation'];

  /**
   * Pre-defined mechanics for each base rune, keyed by the item's slug.
   * rules[]     — passive rule elements applied to the target while inscribed.
   * invocation  — data used by the Invoke Rune macro to roll damage/saves.
   */
  static RUNE_DATA = {
    'atryl-rune-of-fire': {
      rules: [],   // passive: fire resistance −6 (rule element format TBD)
      invocation: {
        damage:       '2d6',
        damageType:   'fire',
        saveAbility:  'fortitude',
        saveDC:       17,
        basicSave:    true,
        critFail:     { slug: 'dazzled', rounds: 1 },
        levelScaling: { per: 2, bonus: '1d6' },
      },
    },
    // Add more runes here as needed.
  };

  /**
   * Invocation bonuses contributed by diacritics.
   * Keyed the same way as DIACRITIC_EFFECTS.
   * Each fn returns an object merged into the invocation flags, or null.
   */
  static DIACRITIC_INVOCATION = {
    'intensity': (casterActor) => {
      const intMod = casterActor?.system?.abilities?.int?.modifier ?? 0;
      return intMod !== 0 ? { flatBonus: intMod } : null;
    },
  };

  /** @type {object|null} socketlib socket handle. */
  static _socket = null;

  /** Pending damage rolls waiting for the GM to click Roll Damage. */
  static _pendingInvocations = new Map();

  // ── Initialization ─────────────────────────────────────────────────────────

  static initialize() {
    if (typeof socketlib !== 'undefined' && typeof socketlib.registerModule === 'function') {
      GBRunesmith._socket = socketlib.registerModule(GBRunesmith.MODULE_ID);
      GBRunesmith._socket.register('runesmith.grant',  data => GBRunesmith._gmGrantRune(data));
      GBRunesmith._socket.register('runesmith.revoke', data => GBRunesmith._gmRevokeRune(data));
      GBRunesmith._socket.register('runesmith.invoke', data => GBRunesmith._gmInvokeRune(data));
    }

    Hooks.on('deleteItem', item => {
      if (!game.user.isGM) return;
      GBRunesmith._onItemDeleted(item);
    });

    console.log("Greenbottle's Toolbelt | Runesmith initialized");
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Trace Rune — select a rune (+ optional diacritics) and inscribe it on
   * the targeted creature. Called by the Trace Rune macro.
   */
  static async traceRune({ caster, target } = {}) {
    if (!caster) {
      const sel = canvas.tokens.controlled[0];
      if (!sel) { ui.notifications.warn('Runesmith | Select your Runesmith token.'); return; }
      caster = sel.actor;
    }
    if (!target) {
      const tgts = game.user.targets;
      if (tgts.size === 0) { ui.notifications.warn('Runesmith | Target a token to inscribe.'); return; }
      target = tgts.first().actor;
    }

    const allRunes = GBRunesmith._findRuneItems(caster);
    if (allRunes.length === 0) {
      ui.notifications.warn(`Runesmith | ${caster.name} has no rune items in their inventory.`);
      return;
    }

    const { base: baseRunes, diacritic: diacritics } = GBRunesmith._categorizeRunes(allRunes);
    const activeRunes = target.getFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES) ?? {};

    const selection = await GBRunesmith._promptTrace(baseRunes, diacritics, activeRunes, target.name, caster);
    if (!selection) return;

    const baseItem    = baseRunes.find(r => r.id === selection.runeId);
    const pairedItems = diacritics.filter(d => selection.diacriticIds.includes(d.id));
    if (!baseItem) return;

    if (activeRunes[baseItem.id]) await GBRunesmith._dispatchRevoke(target, baseItem.id, caster);
    await GBRunesmith._dispatchGrant(target, baseItem, pairedItems, caster);
  }

  /**
   * Invoke Rune — list all runes this caster has active on the scene,
   * pick one, roll the save + apply damage, then remove the rune.
   * Called by the Invoke Rune macro.
   */
  static async invokeRune({ caster } = {}) {
    if (!caster) {
      const sel = canvas.tokens.controlled[0];
      if (!sel) { ui.notifications.warn('Runesmith | Select your Runesmith token.'); return; }
      caster = sel.actor;
    }

    const entries = GBRunesmith._findCasterActiveRunes(caster);
    if (entries.length === 0) {
      ui.notifications.warn(`Runesmith | ${caster.name} has no active runes on the field.`);
      return;
    }

    const entry = await GBRunesmith._promptInvoke(entries);
    if (!entry) return;

    if (game.user.isGM) {
      await GBRunesmith._executeInvocation(caster, entry);
    } else if (GBRunesmith._socket) {
      await GBRunesmith._socket.executeAsGM('runesmith.invoke', {
        casterActorId: caster.id,
        targetActorId: entry.actor.id,
        tokenId:       entry.token?.id ?? null,
        runeItemId:    entry.runeItemId,
        invocation:    entry.invocation,
        runeName:      entry.entry.runeName,
      });
    } else {
      ui.notifications.error('Runesmith | socketlib is required for non-GM use.');
    }
  }

  // ── Dispatch Helpers ───────────────────────────────────────────────────────

  static async _dispatchGrant(target, baseItem, pairedItems, caster) {
    if (game.user.isGM) {
      await GBRunesmith._grantRune(target, baseItem, pairedItems, caster);
    } else if (GBRunesmith._socket) {
      await GBRunesmith._socket.executeAsGM('runesmith.grant', {
        targetActorId:          target.id,
        runeItemId:             baseItem.id,
        casterActorId:          caster.id,
        pairedDiacriticItemIds: pairedItems.map(d => d.id),
      });
    } else {
      ui.notifications.error('Runesmith | socketlib is required for non-GM use.');
    }
  }

  static async _dispatchRevoke(target, runeId, caster) {
    if (game.user.isGM) {
      await GBRunesmith._revokeRune(target, runeId);
    } else if (GBRunesmith._socket) {
      await GBRunesmith._socket.executeAsGM('runesmith.revoke', {
        targetActorId: target.id,
        runeId,
      });
    } else {
      ui.notifications.error('Runesmith | socketlib is required for non-GM use.');
    }
  }

  // ── Inventory Scan ─────────────────────────────────────────────────────────

  static _findRuneItems(actor) {
    return actor.items.filter(item => {
      if (!GBRunesmith.PHYSICAL_ITEM_TYPES.has(item.type)) return false;
      const traits = item.system?.traits?.value ?? [];
      if (traits.some(t => GBRunesmith.RUNE_TRAITS.includes(t.toLowerCase()))) return true;
      return GBRunesmith.RUNE_NAME_PATTERN.test(item.name);
    });
  }

  /**
   * Split rune items into base runes and diacritics.
   * Diacritics are identified by having the 'diacritic' trait.
   *
   * @param {Item[]} items
   * @returns {{ base: Item[], diacritic: Item[] }}
   */
  static _categorizeRunes(items) {
    const base      = [];
    const diacritic = [];
    for (const item of items) {
      const traits = (item.system?.traits?.value ?? []).map(t => t.toLowerCase());
      if (traits.includes('diacritic')) {
        diacritic.push(item);
      } else {
        base.push(item);
      }
    }
    return { base, diacritic };
  }

  // ── Dialogs ────────────────────────────────────────────────────────────────

  /**
   * Trace Rune dialog. One rune selected via radio; diacritics shown beneath
   * each rune as toggle chips (only enabled for the selected rune).
   * Returns { runeId, diacriticIds } or null.
   */
  static _promptTrace(baseRunes, diacritics, activeRunes, targetName, caster) {
    // Pre-select the first rune (radio behaviour: exactly one must be chosen).
    let selectedRuneId = baseRunes[0]?.id ?? null;
    const pairedDiacritics = new Set(); // dia IDs paired with the currently selected rune

    const diacriticHint = (dia) => {
      const key = GBRunesmith._diacriticKey(dia);
      if (key === 'intensity') {
        const mod = caster?.system?.abilities?.int?.modifier ?? 0;
        return `+${mod} dmg (INT)`;
      }
      if (key === 'preservation') return 're-applies after use';
      return '';
    };

    const blocks = baseRunes.map((base, i) => {
      const sel   = i === 0; // first rune pre-selected
      const level = base.system?.level?.value ?? base.system?.level ?? '';
      const chips = diacritics.map(dia => {
        const hint      = diacriticHint(dia);
        const shortName = dia.name.replace(/,\s*(Diacritic Rune of|Diacritic)\s*/i, ' ').trim();
        return `<button type="button" class="gb-rs-dia-chip"
                        data-rune-id="${base.id}" data-dia-id="${dia.id}" data-on="false"
                        ${sel ? '' : 'disabled'}
                        style="${GBRunesmith._diacriticBtnStyle(false, !sel)}"
                        title="${dia.name}">
                  ${shortName}${hint ? ` <span style="opacity:0.7">(${hint})</span>` : ''}
                </button>`;
      }).join('');

      return `
        <div class="gb-rs-trace-block" data-rune-id="${base.id}"
             style="margin-bottom:6px;border:2px solid ${sel ? '#4caf50' : 'rgba(128,128,128,0.3)'};
                    border-radius:6px;overflow:hidden;cursor:pointer;">
          <div class="gb-rs-trace-header" data-rune-id="${base.id}"
               style="display:flex;align-items:center;gap:8px;padding:6px 10px;
                      background:${sel ? 'rgba(76,175,80,0.18)' : 'rgba(128,128,128,0.07)'};">
            <i class="fas fa-${sel ? 'circle-dot' : 'circle'}"
               style="color:${sel ? '#4caf50' : 'rgba(128,128,128,0.5)'};font-size:1em;flex-shrink:0;"></i>
            <img src="${base.img}" width="26" height="26"
                 style="border:none;border-radius:3px;flex-shrink:0;"/>
            <span style="font-size:0.88em;font-weight:600;flex:1;overflow:hidden;
                         text-overflow:ellipsis;white-space:nowrap;">
              ${base.name}${level !== '' ? `<span style="font-weight:400;opacity:0.6;
                font-size:0.85em;margin-left:4px;">Lv${level}</span>` : ''}
            </span>
          </div>
          ${diacritics.length > 0 ? `
            <div class="gb-rs-dia-row" data-rune-id="${base.id}"
                 style="display:flex;flex-wrap:wrap;gap:4px;padding:5px 10px;
                        background:rgba(0,0,0,0.12);border-top:1px solid rgba(128,128,128,0.2);">
              <span style="font-size:0.75em;opacity:0.6;align-self:center;margin-right:2px;">
                Pair:</span>
              ${chips}
            </div>` : ''}
        </div>`;
    }).join('');

    const content = `
      <p style="margin:0 0 8px;font-size:0.9em;">
        Inscribe on <strong>${targetName}</strong>:
      </p>
      <div class="gb-rs-trace">${blocks}</div>`;

    Hooks.once('renderDialogV2', (app, html) => {
      const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
      if (!root?.querySelector('.gb-rs-trace')) return;

      const selectRune = (runeId) => {
        if (runeId === selectedRuneId) return;
        selectedRuneId = runeId;
        pairedDiacritics.clear();

        root.querySelectorAll('.gb-rs-trace-block').forEach(block => {
          const bid = block.dataset.runeId;
          const sel = bid === runeId;
          block.style.borderColor = sel ? '#4caf50' : 'rgba(128,128,128,0.3)';

          const hdr = block.querySelector('.gb-rs-trace-header');
          if (hdr) hdr.style.background = sel ? 'rgba(76,175,80,0.18)' : 'rgba(128,128,128,0.07)';

          const icon = hdr?.querySelector('i');
          if (icon) {
            icon.className = `fas fa-${sel ? 'circle-dot' : 'circle'}`;
            icon.style.color = sel ? '#4caf50' : 'rgba(128,128,128,0.5)';
          }

          block.querySelectorAll('.gb-rs-dia-chip').forEach(chip => {
            chip.disabled     = !sel;
            chip.dataset.on   = 'false';
            chip.style.cssText = GBRunesmith._diacriticBtnStyle(false, !sel);
          });
        });
      };

      root.querySelectorAll('.gb-rs-trace-header').forEach(hdr => {
        hdr.addEventListener('click', () => selectRune(hdr.dataset.runeId));
      });

      root.querySelectorAll('.gb-rs-dia-chip').forEach(chip => {
        chip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (chip.disabled) return;
          const diaId = chip.dataset.diaId;
          const on    = chip.dataset.on !== 'true';

          const diaItem = diacritics.find(d => d.id === diaId);
          if (on && diaItem && GBRunesmith._isDiacriticExclusive(diaItem)) {
            pairedDiacritics.delete(diaId);
            root.querySelectorAll(`.gb-rs-dia-chip[data-dia-id="${diaId}"]`).forEach(c => {
              c.dataset.on   = 'false';
              c.style.cssText = GBRunesmith._diacriticBtnStyle(false, c.disabled);
            });
          }

          if (on) pairedDiacritics.add(diaId);
          else    pairedDiacritics.delete(diaId);
          chip.dataset.on    = String(on);
          chip.style.cssText = GBRunesmith._diacriticBtnStyle(on, false);
        });
      });
    });

    return foundry.applications.api.DialogV2.wait({
      window:      { title: 'Trace Rune' },
      position:    { width: 400 },
      content,
      rejectClose: false,
      buttons: [
        {
          action:   'inscribe',
          label:    'Inscribe',
          icon:     'fa-solid fa-pen-nib',
          default:  true,
          callback: () => selectedRuneId
            ? { runeId: selectedRuneId, diacriticIds: [...pairedDiacritics] }
            : null,
        },
        {
          action:   'cancel',
          label:    'Cancel',
          icon:     'fa-solid fa-times',
          callback: () => null,
        },
      ],
    });
  }

  /**
   * Invoke Rune dialog. Lists all active runes placed by this caster.
   * Returns the selected entry object or null.
   */
  static _promptInvoke(entries) {
    const blocks = entries.map((e, i) => {
      const inv       = e.invocation;
      const targetName = e.actor.name;
      const summary   = inv
        ? `${inv.damage}${inv.flatBonus ? `+${inv.flatBonus}` : ''} ${inv.damageType}`
          + ` · DC ${inv.saveDC} basic ${inv.saveAbility}`
        : '(no invocation data)';
      const sel = i === 0;

      return `
        <div class="gb-rs-invoke-entry" data-idx="${i}"
             style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;
                    border:2px solid ${sel ? '#4caf50' : 'rgba(128,128,128,0.3)'};border-radius:6px;
                    margin-bottom:6px;cursor:pointer;background:${sel ? 'rgba(76,175,80,0.18)' : 'rgba(128,128,128,0.07)'};">
          <i class="fas fa-${sel ? 'circle-dot' : 'circle'}"
             style="color:${sel ? '#4caf50' : 'rgba(128,128,128,0.5)'};font-size:1em;margin-top:3px;flex-shrink:0;"></i>
          <div>
            <div style="font-size:0.88em;font-weight:600;">${e.entry.runeName}</div>
            <div style="font-size:0.78em;opacity:0.7;">on <strong>${targetName}</strong></div>
            <div style="font-size:0.76em;opacity:0.55;margin-top:2px;">${summary}</div>
          </div>
        </div>`;
    }).join('');

    const content = `
      <p style="margin:0 0 8px;font-size:0.9em;">Choose a rune to invoke:</p>
      <div class="gb-rs-invoke">${blocks}</div>`;

    let selectedIdx = 0;

    Hooks.once('renderDialogV2', (app, html) => {
      const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
      if (!root?.querySelector('.gb-rs-invoke')) return;

      root.querySelectorAll('.gb-rs-invoke-entry').forEach(el => {
        el.addEventListener('click', () => {
          selectedIdx = Number(el.dataset.idx);
          root.querySelectorAll('.gb-rs-invoke-entry').forEach((e, i) => {
            const sel = i === selectedIdx;
            e.style.borderColor = sel ? '#4caf50' : 'rgba(128,128,128,0.3)';
            e.style.background  = sel ? 'rgba(76,175,80,0.18)' : 'rgba(128,128,128,0.07)';
            const icon = e.querySelector('i');
            if (icon) { icon.className = `fas fa-${sel ? 'circle-dot' : 'circle'}`; icon.style.color = sel ? '#4caf50' : 'rgba(128,128,128,0.5)'; }
          });
        });
      });
    });

    return foundry.applications.api.DialogV2.wait({
      window:      { title: 'Invoke Rune' },
      position:    { width: 400 },
      content,
      rejectClose: false,
      buttons: [
        {
          action:   'invoke',
          label:    'Invoke',
          icon:     'fa-solid fa-bolt',
          default:  true,
          callback: () => entries[selectedIdx] ?? null,
        },
        {
          action:   'cancel',
          label:    'Cancel',
          icon:     'fa-solid fa-times',
          callback: () => null,
        },
      ],
    });
  }

  // ── Grant & Revoke ─────────────────────────────────────────────────────────

  /**
   * Create the extempore rune effect on the target actor.
   * If pairedItems are provided, their rules are merged in and the effect
   * name and description reflect the pairing.
   *
   * @param {Actor}  target
   * @param {Item}   baseItem         The base rune from the caster's inventory.
   * @param {Item[]} pairedItems      Diacritic items paired with this rune.
   * @param {Actor}  caster
   */
  static async _grantRune(target, baseItem, pairedItems, caster) {
    const runeData       = GBRunesmith.RUNE_DATA[baseItem.system?.slug ?? ''] ?? null;
    const baseRules      = runeData ? foundry.utils.deepClone(runeData.rules)
                                    : GBRunesmith._extractRules(baseItem);
    const diacriticRules = pairedItems.flatMap(d => GBRunesmith._diacriticRules(d, caster));
    const allRules       = [...baseRules, ...diacriticRules];

    // Build invocation data, merging in any diacritic bonuses (e.g. Ur- flat damage).
    let invocation = runeData?.invocation ? foundry.utils.deepClone(runeData.invocation) : null;
    if (invocation) {
      for (const d of pairedItems) {
        const bonus = GBRunesmith._diacriticInvocationBonus(d, caster);
        if (bonus) foundry.utils.mergeObject(invocation, bonus);
      }
    }

    const effectName = pairedItems.length > 0
      ? `Extempore: ${baseItem.name} + ${pairedItems.map(d => d.name.split(',')[0]).join(' + ')}`
      : `Extempore: ${baseItem.name}`;

    const baseDesc = baseItem.system?.description?.value ?? '';
    const diaDescs = pairedItems
      .map(d => {
        const hint = d.system?.description?.value ?? '';
        const preservation = GBRunesmith._isDiacriticExclusive(d);
        const extra = preservation
          ? '<em>Note: Preservation re-application is not automated — re-cast manually.</em>'
          : '';
        return hint || extra
          ? `<hr/><strong>${d.name}</strong><br/>${hint}${extra ? `<br/>${extra}` : ''}`
          : '';
      })
      .filter(Boolean)
      .join('');

    const effectData = {
      type: 'effect',
      name: effectName,
      img:  baseItem.img,
      system: {
        tokenIcon:   { show: true },
        duration:    { value: GBRunesmith.EFFECT_DURATION_MINUTES, unit: 'minutes', sustained: false, expiry: 'turn-start' },
        description: { value: baseDesc + diaDescs },
        rules:       allRules,
      },
      flags: {
        [GBRunesmith.MODULE_ID]: {
          [GBRunesmith.FLAG_IS_RUNE_EFFECT]: true,
          runeId:             baseItem.id,
          runeName:           effectName,
          pairedDiacriticIds: pairedItems.map(d => d.id),
          casterActorId:      caster.id,
          ...(invocation ? { invocation } : {}),
        },
      },
    };

    const [effect] = await target.createEmbeddedDocuments('Item', [effectData]);

    const updated = foundry.utils.deepClone(
      target.getFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES) ?? {}
    );
    updated[baseItem.id] = {
      effectItemId:       effect.id,
      runeName:           effectName,
      casterActorId:      caster.id,
      pairedDiacriticIds: pairedItems.map(d => d.id),
    };
    await target.setFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES, updated);

    const ruleNote = allRules.length === 0 ? ' (no rule elements — effect is cosmetic only)' : '';
    ui.notifications.info(`Runesmith | ${effectName} inscribed on ${target.name}.${ruleNote}`);
    console.log(`GBRunesmith | Granted "${effectName}" to ${target.name} (${allRules.length} rules)`);
  }

  /**
   * Remove an extempore rune effect by its base rune item ID (tracking key).
   *
   * @param {Actor}  target
   * @param {string} runeId
   */
  static async _revokeRune(target, runeId) {
    const activeRunes = target.getFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES) ?? {};
    const entry = activeRunes[runeId];
    if (!entry) return;

    if (entry.effectItemId && target.items.get(entry.effectItemId)) {
      await target.deleteEmbeddedDocuments('Item', [entry.effectItemId]);
    }
    await GBRunesmith._clearRuneFlag(target, runeId);
    console.log(`GBRunesmith | Revoked "${entry.runeName}" from ${target.name}`);
  }

  static async _clearRuneFlag(actor, runeId) {
    const current = actor.getFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES) ?? {};
    if (!(runeId in current)) return;

    const updated = foundry.utils.deepClone(current);
    delete updated[runeId];

    if (Object.keys(updated).length > 0) {
      await actor.setFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES, updated);
    } else {
      await actor.unsetFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES);
    }
  }

  // ── Rule Element Helpers ───────────────────────────────────────────────────

  /**
   * Deep-clone the base rune's rule elements and fix up any item-scoped selectors.
   *
   * @param {Item} runeItem
   * @returns {object[]}
   */
  static _extractRules(runeItem) {
    const raw = foundry.utils.deepClone(runeItem.system?.rules ?? []);
    for (const rule of raw) {
      if (typeof rule.selector !== 'string' || !rule.selector.includes('{item|')) continue;
      rule.selector = rule.key === 'DamageDice' || rule.selector.includes('damage')
        ? 'strike-damage'
        : 'strike-attack-roll';
      console.log(`GBRunesmith | Rewrote item-scoped selector on "${rule.key}" → "${rule.selector}"`);
    }
    return raw;
  }

  /**
   * Return the rule elements contributed by a diacritic item.
   * Resolves known diacritics via DIACRITIC_EFFECTS; returns [] for unknown ones.
   *
   * @param {Item}  diacriticItem
   * @param {Actor} casterActor
   * @returns {object[]}
   */
  static _diacriticRules(diacriticItem, casterActor) {
    const key = GBRunesmith._diacriticKey(diacriticItem);
    if (!key) return [];
    const fn = GBRunesmith.DIACRITIC_EFFECTS[key];
    return fn ? fn(casterActor) : [];
  }

  /**
   * Return invocation bonus data contributed by a diacritic (e.g. Ur- flat damage).
   * Merged into the effect's invocation flags at grant time.
   *
   * @param {Item}  diacriticItem
   * @param {Actor} casterActor
   * @returns {object|null}
   */
  static _diacriticInvocationBonus(diacriticItem, casterActor) {
    const key = GBRunesmith._diacriticKey(diacriticItem);
    if (!key) return null;
    const fn = GBRunesmith.DIACRITIC_INVOCATION?.[key];
    return fn ? fn(casterActor) : null;
  }

  // ── Invoke Helpers ─────────────────────────────────────────────────────────

  /**
   * Scan all tokens on the current scene for active rune effects belonging
   * to this caster. Returns an array of entry objects for _promptInvoke.
   */
  static _findCasterActiveRunes(casterActor) {
    const results  = [];
    const seenActors = new Set();

    for (const token of canvas.tokens.placeables) {
      const actor = token.actor;
      if (!actor) continue;
      if (seenActors.has(actor.uuid)) continue;
      seenActors.add(actor.uuid);

      const runeMap = actor.getFlag(GBRunesmith.MODULE_ID, GBRunesmith.FLAG_RUNES) ?? {};
      for (const [runeItemId, entry] of Object.entries(runeMap)) {
        if (entry.casterActorId !== casterActor.id) continue;
        const effectItem = actor.items.get(entry.effectItemId);
        if (!effectItem) continue;
        const invocation = effectItem.flags?.[GBRunesmith.MODULE_ID]?.invocation ?? null;
        results.push({ actor, token, runeItemId, entry, effectItem, invocation });
      }
    }
    return results;
  }

  /**
   * Build the damage roll formula for a rune invocation at the caster's level,
   * including level-scaling dice and any flat bonus from diacritics.
   */
  static _buildDamageFormula(invocation, casterLevel) {
    let formula = invocation.damage;

    if (invocation.levelScaling) {
      const increments = Math.floor(casterLevel / invocation.levelScaling.per);
      if (increments > 0) {
        const m = invocation.levelScaling.bonus.match(/^(\d+)d(\d+)$/i);
        if (m) formula += `+${parseInt(m[1]) * increments}d${m[2]}`;
        else {
          const n = parseFloat(invocation.levelScaling.bonus);
          if (!isNaN(n)) formula += `+${n * increments}`;
        }
      }
    }

    if (invocation.flatBonus) formula += `+${invocation.flatBonus}`;
    return `${formula}[${invocation.damageType}]`;
  }

  /**
   * Execute a rune invocation. Posts a chat card with:
   *   - A clickable @Check save button (GM clicks when ready — not auto-rolled)
   *   - A "Roll Damage" button
   *
   * When Roll Damage is clicked, the target is re-targeted so PF2e can find any
   * save results already in chat and render per-target DAMAGE/HALF/DOUBLE/BLOCK
   * buttons on the damage card, matching the Electric Arc / spell card behaviour.
   *
   * Runs on the GM (either directly or via socket).
   */
  static async _executeInvocation(caster, entry) {
    const { actor: target, token: targetToken, runeItemId, invocation, entry: flagEntry } = entry;

    if (!invocation) {
      ui.notifications.error(`Runesmith | ${flagEntry.runeName} has no invocation data.`);
      return;
    }

    const level   = caster.system?.details?.level?.value ?? 1;
    const formula = GBRunesmith._buildDamageFormula(invocation, level);

    // Point Foundry's targeting at the rune's target so PF2e can match save
    // results to targets when the damage card is posted.
    const targetTokenId = targetToken?.id ?? null;
    if (targetTokenId) game.user.updateTokenTargets([targetTokenId]);

    // 1. Build the invocation card: @Check save button + deferred Roll Damage button.
    const saveLabel = invocation.saveAbility.charAt(0).toUpperCase() + invocation.saveAbility.slice(1);
    const basicFlag = invocation.basicSave ? '|basic:true' : '';
    const checkTag  = `@Check[type:${invocation.saveAbility}|dc:${invocation.saveDC}${basicFlag}]{${saveLabel} DC ${invocation.saveDC}}`;
    const cardId    = foundry.utils.randomID();

    const rawContent = `
      <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:6px;">
        <p style="margin:0;font-size:0.95em;font-weight:600;">${flagEntry.runeName}</p>
        <p style="margin:0;font-size:0.85em;opacity:0.75;">on <strong>${target.name}</strong></p>
        <p style="margin:6px 0 0;">${checkTag}</p>
      </div>`;
    const enriched = await TextEditor.enrichHTML(rawContent, { async: true });

    // 2. Register a pending entry so the Roll Damage button can find its data.
    GBRunesmith._pendingInvocations.set(cardId, {
      casterActorId: caster.id,
      formula,
      runeName: flagEntry.runeName,
      targetTokenId,
    });

    // 3. Attach Roll Damage click handler once the card renders.
    const hookId = Hooks.on('renderChatMessage', (_msg, html) => {
      const root = html instanceof HTMLElement ? html : html?.[0];
      const btn  = root?.querySelector?.(`[data-gb-rune-dmg="${cardId}"]`);
      if (!btn) return;
      Hooks.off('renderChatMessage', hookId);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const pending = GBRunesmith._pendingInvocations.get(cardId);
        GBRunesmith._pendingInvocations.delete(cardId);
        if (!pending) return;
        // Re-target so PF2e's damage card finds the save results in chat.
        if (pending.targetTokenId) game.user.updateTokenTargets([pending.targetTokenId]);
        const actor = game.actors.get(pending.casterActorId);
        const DamageRollCls = CONFIG.Dice?.DamageRoll ?? Roll;
        const dmgRoll = await new DamageRollCls(pending.formula).evaluate();
        await dmgRoll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor }),
          flavor:  `<strong>${pending.runeName}</strong>`,
        });
      });
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: enriched
        + `<button data-gb-rune-dmg="${cardId}" style="width:100%;margin-top:4px;">
             <i class="fa-solid fa-dice-d6"></i> Roll Damage
             <span style="opacity:0.6;font-size:0.85em;margin-left:4px;">${formula}</span>
           </button>`,
    });

    // 4. Rune is consumed on invocation regardless of outcome.
    await GBRunesmith._revokeRune(target, runeItemId);
  }

  static async _gmInvokeRune({ casterActorId, targetActorId, tokenId, runeItemId, invocation, runeName }) {
    const caster = game.actors.get(casterActorId);
    const target = game.actors.get(targetActorId);
    if (!caster || !target) return;

    const token = tokenId ? canvas.tokens.get(tokenId) : null;
    await GBRunesmith._executeInvocation(caster, {
      actor: target, token, runeItemId, invocation,
      entry: { runeName, casterActorId },
    });
  }

  // ── Diacritic Key Helpers ──────────────────────────────────────────────────

  /**
   * Match a diacritic item to a DIACRITIC_EFFECTS key.
   *
   * @param {Item} item
   * @returns {string|null}
   */
  static _diacriticKey(item) {
    const slug = (item.system?.slug ?? '').toLowerCase();
    const name = item.name.toLowerCase();
    const combined = slug || name;
    return Object.keys(GBRunesmith.DIACRITIC_EFFECTS).find(k => combined.includes(k)) ?? null;
  }

  /**
   * Returns true if this diacritic can only be applied to one base rune at a time.
   *
   * @param {Item} diacriticItem
   * @returns {boolean}
   */
  static _isDiacriticExclusive(diacriticItem) {
    const slug = (diacriticItem.system?.slug ?? '').toLowerCase();
    const name = diacriticItem.name.toLowerCase();
    const combined = slug || name;
    return GBRunesmith.DIACRITIC_EXCLUSIVE.some(k => combined.includes(k));
  }

  // ── GM Socket Handlers ─────────────────────────────────────────────────────

  static async _gmGrantRune({ targetActorId, runeItemId, casterActorId, pairedDiacriticItemIds = [] }) {
    const target = game.actors.get(targetActorId);
    const caster = game.actors.get(casterActorId);
    if (!target || !caster) {
      console.error('GBRunesmith | _gmGrantRune: could not resolve target or caster.');
      return;
    }
    const baseItem    = caster.items.get(runeItemId);
    const pairedItems = pairedDiacriticItemIds.map(id => caster.items.get(id)).filter(Boolean);
    if (!baseItem) {
      console.error(`GBRunesmith | _gmGrantRune: rune item ${runeItemId} not found.`);
      return;
    }
    await GBRunesmith._grantRune(target, baseItem, pairedItems, caster);
  }

  static async _gmRevokeRune({ targetActorId, runeId }) {
    const target = game.actors.get(targetActorId);
    if (!target) return;
    await GBRunesmith._revokeRune(target, runeId);
  }

  // ── Cleanup Hook ───────────────────────────────────────────────────────────

  static async _onItemDeleted(item) {
    const actor = item.actor;
    if (!actor) return;
    const flags = item.flags?.[GBRunesmith.MODULE_ID];
    if (!flags?.[GBRunesmith.FLAG_IS_RUNE_EFFECT]) return;
    const runeId = flags.runeId;
    if (!runeId) return;
    await GBRunesmith._clearRuneFlag(actor, runeId);
    console.log(`GBRunesmith | Rune effect expired/deleted — cleared "${flags.runeName}" from ${actor.name}`);
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  static _toggleStyle(on) {
    const bg     = on ? '#e8f5e9' : '#f0f0f0';
    const border = on ? '#4caf50' : '#bbb';
    const color  = on ? '#1b5e20' : '#444';
    return `background:${bg};border:2px solid ${border};color:${color};cursor:pointer;transition:background 0.1s`;
  }

  static _diacriticBtnStyle(on, disabled) {
    if (disabled) return [
      'display:inline-flex', 'align-items:center', 'gap:4px',
      'padding:3px 7px', 'border-radius:10px', 'font-size:0.78em',
      'border:1px solid rgba(128,128,128,0.25)', 'background:rgba(128,128,128,0.07)',
      'color:rgba(128,128,128,0.4)', 'cursor:not-allowed', 'opacity:0.6',
    ].join(';');
    return [
      'display:inline-flex', 'align-items:center', 'gap:4px',
      'padding:3px 7px', 'border-radius:10px', 'font-size:0.78em', 'cursor:pointer',
      `border:1px solid ${on ? '#5b9bd5' : 'rgba(128,128,128,0.35)'}`,
      `background:${on ? 'rgba(91,155,213,0.2)' : 'rgba(128,128,128,0.1)'}`,
      `color:${on ? '#a8d1f0' : 'inherit'}`,
    ].join(';');
  }
}


// ── Entry point ──────────────────────────────────────────────────────────────
// Self-registering: this file runs in its own module scope, so we initialize
// via our own init hook (runs after toolbelt.js's init hook since this file
// is listed third in module.json's esmodules array).

Hooks.once('init', () => {
  const module = game.modules.get(GBRunesmith.MODULE_ID);
  if (module?.api) {
    module.api.runesmith = GBRunesmith;
  }
  GBRunesmith.initialize();
});
