# Greenbottle's Module Ecosystem

Unified reference for all Greenbottle's FoundryVTT modules, built for Pathfinder 2e / Starfinder 2e (via sf2e-anachronism).

**Foundry:** v13–v14 | **System:** PF2e 6.0+

---

## Module Overview

| Module | Version | Purpose |
|--------|---------|---------|
| [greenbottles-toolbelt](#greenbottles-toolbelt) | 1.4.0 | Shared utility library + GM tools (required by all others) |
| [greenbottles-ammo-belt](#greenbottles-ammo-belt) | 1.2.0 | Custom SF2e ammo types + weapon assignment UI |
| [greenbottles-hacking-quips](#greenbottles-hacking-quips) | 2.2.0 | Hacking quips, Timber Sentinel, Knives & Daggers |
| [greenbottles-vitality-network](#greenbottles-vitality-network) | 1.2.0 | SF2e vitality network automation |

All modules expose their packs in a single **"Greenbottle's Toolbelt"** folder in the Foundry compendium sidebar *(each module declares the same `packFolders` name; Foundry merges them automatically — the toolbelt itself has no packs)*.

---

## Dependency Map

```
greenbottles-toolbelt          ← no module dependencies
greenbottles-ammo-belt         ← requires: greenbottles-toolbelt, sf2e-anachronism
greenbottles-hacking-quips     ← requires: greenbottles-toolbelt
greenbottles-vitality-network  ← requires: greenbottles-toolbelt, pf2e-toolbelt
```

---

## Installation

All modules are installable via Foundry Package Manager (search by name) or by pasting the manifest URL in **Add-on Modules → Install Module**.

| Module | Manifest URL |
|--------|-------------|
| greenbottles-toolbelt | `https://github.com/Ayabara1013/greenbottles-toolbelt/releases/latest/download/module.json` |
| greenbottles-ammo-belt | `https://github.com/Ayabara1013/greenbottles-ammo-belt/releases/latest/download/module.json` |
| greenbottles-hacking-quips | `https://github.com/Ayabara1013/greenbottles-hacking-quips/releases/latest/download/module.json` |
| greenbottles-vitality-network | `https://github.com/Ayabara1013/greenbottles-vitality-network/releases/latest/download/module.json` |

---

---

## Greenbottle's Toolbelt

**Repo:** [greenbottles-toolbelt](https://github.com/Ayabara1013/greenbottles-toolbelt) | **v1.4.0**

Shared utility library for all Greenbottle's modules. Also includes several GM-facing features: hero point management, Plant Banner automation, actor sheet toolbar filtering, and SF2e spell/feat automation (Elemental Weapon, Runesmith).

### Using the API

```js
const GBToolbelt = game.modules.get('greenbottles-toolbelt')?.api;
if (!GBToolbelt) {
  ui.notifications.error("Greenbottle's Toolbelt is required.");
  return;
}
```

### GBToolbelt API

#### Actor Resources

**`GBToolbelt.getActorResource(actor, resourcePath)`**
Reads a nested property from an actor using a dot-separated path.
```js
const hp = GBToolbelt.getActorResource(actor, 'system.resources.heroPoints.value');
```

**`GBToolbelt.updateActorResource(actor, resourcePath, newValue, options?)`**
Updates a nested actor resource. Automatically clamps between `0` and the corresponding `.max` if one exists. Returns `Promise<Actor>`.

| Option | Default | Description |
|--------|---------|-------------|
| `notify` | `true` | Show a `ui.notifications` message on success |
| `label` | resource key | Human-readable label for the notification |

```js
await GBToolbelt.updateActorResource(actor, 'system.resources.heroPoints.value', 3, {
  label: 'Hero Points'
});
```

#### World Item Search

**`GBToolbelt.findWorldItems(filterFn)`**
Searches both the world item directory and every actor's inventory. Returns a flat array.
```js
const ammoItems = GBToolbelt.findWorldItems(i => i.type === 'ammunition');
```

#### Module Data Loading

**`GBToolbelt.loadModuleData(moduleId, primaryPath, customPath?)`**
Fetches a JSON data file. If `customPath` exists, its entries are merged on top (custom wins). Arrays are concatenated; objects are shallow-merged.
```js
const trees = await GBToolbelt.loadModuleData(
  'greenbottles-hacking-quips',
  'modules/greenbottles-hacking-quips/data/trees.json',
  'modules/greenbottles-hacking-quips/data/custom-trees.json'
);
```

#### Module Registry

**`GBToolbelt.isModuleActive(moduleId)`** — Returns `true` if the module is installed and active.

#### Settings Helpers

```js
GBToolbelt.registerSetting(moduleId, key, options);  // wraps game.settings.register
GBToolbelt.getSetting(moduleId, key);                // wraps game.settings.get
GBToolbelt.setSetting(moduleId, key, value);         // wraps game.settings.set, returns Promise
```

### GBHeroPoints

GM-only star button (⭐) in the Token Controls toolbar. Opens a dialog for bulk PF2e party hero point operations. Reads the active party from `game.actors.party.members`.

| Button | Behavior |
|--------|----------|
| Add 1 | Increment every member by 1 (skips those already at max) |
| Set all to 2 | Set everyone to exactly 2 |
| Top up | Bring anyone below 2 up to 2 (skips those already at 2+) |
| Clear | Set everyone to 0 |

Uses `GBToolbelt.updateActorResource()` internally for clamped writes.

### GBCommanderBanner

Automates the Plant Banner commander feat. When a banner token is placed on the canvas (via Portal crosshair), it registers an aura template that follows the token on move. At the start of each of the commander's turns, adjacent allies automatically receive temp HP equal to the commander's Charisma modifier (minimum 1). A chat card is posted each turn (visible to all players) with a clickable Apply button as an alternative to automatic application.

**Requires:** socketlib (for non-GM players placing banners), portal-lib (for crosshair placement UI).

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-Apply Temp HP | `true` | Apply temp HP automatically; if off, chat card button only |
| Banner Aura Radius | `15` | Radius in feet of the banner's aura |

### GBToolbarFilter

GM-only per-button, per-actor-type visibility control for actor sheet header buttons added by modules.

**Module Settings → Toolbar Button Visibility → Configure** opens a checkbox grid: rows are all discovered module buttons, columns are PF2e actor types. Unchecking a cell hides that button for that actor type on every sheet open. A master enable/disable toggle is also available.

Buttons are auto-discovered: the filter watches `getActorSheetHeaderButtons` for API-registered buttons and performs a deferred DOM scan after each render to catch buttons injected directly into the DOM (e.g. modules that use `renderActorSheet`).

| Setting | Scope | Description |
|---------|-------|-------------|
| Toolbar Filter: Enabled | World | Master switch — disable to show all buttons regardless of rules |
| Toolbar Button Visibility → Configure | World, GM only | Opens the checkbox grid dialog |

### GBElementalWeapon

Automation for the SF2e **Elemental Weapon** focus spell.

On cast, prompts the caster to choose an element (Air/Earth/Fire/Metal/Water/Wood). Derives weapon grade and item level from the spell rank, creates a real weapon item in the caster's inventory with the correct damage type and traits, and attaches a spell effect. When the effect expires or is dismissed, the weapon is removed automatically.

```js
const api = game.modules.get('greenbottles-toolbelt')?.api;
await api.elementalWeapon.cast();
```

### GBRunesmith

Automation for the SF2e **Runesmith** extempore rune inscription feat.

Reads base runes and diacritics (identified by the `diacritic` trait) from the Runesmith's inventory. A persistent UI lets the player pick a base rune and optional diacritic; the combined rule elements are applied to the target weapon as a single effect. Includes setup and invocation macros in the `macros/` folder.

```js
const api = game.modules.get('greenbottles-toolbelt')?.api;
await api.runesmith.manageRunes();  // open the rune selection UI
```

### Declaring as a Dependency

In your module's `module.json`:
```json
"relationships": {
  "requires": [
    {
      "id": "greenbottles-toolbelt",
      "type": "module",
      "compatibility": { "minimum": "1.4.0" }
    }
  ]
}
```

### Changelog

| Version | Changes |
|---------|---------|
| 1.4.0 | GBToolbarFilter — per-button per-actor-type header button visibility. GBElementalWeapon — Elemental Weapon focus spell automation. GBRunesmith — Runesmith extempore rune inscription automation. SF2e anachronism v2 icon migration macro. |
| 1.3.0 | GBCommanderBanner — Plant Banner feat automation with aura template, auto temp HP, and chat card. socketlib integration for non-GM banner placement. |
| 1.1.0 | Absorbed `greenbottles-toolbelt__hero-points` (deprecated). `GBHeroPoints` class now lives here. |
| 1.0.0 | Initial release: `GBToolbelt` shared utility library |

---

---

## Greenbottle's Ammo Belt

**Repo:** [greenbottles-ammo-belt](https://github.com/Ayabara1013/greenbottles-ammo-belt) | **v1.1.2.7**
**Requires:** greenbottles-toolbelt, sf2e-anachronism

Adds custom SF2e ammunition types to PF2e's `CONFIG.PF2E.ammoTypes` and provides a GM settings menu for assigning them to weapons.

### Custom Ammo Types

| ID | Label | Added |
|----|-------|-------|
| `gb-ammo-light-rounds` | GB's Light Rounds | v1.0.0 |
| `gb-ammo-medium-rounds` | GB's Medium Rounds | v1.0.0 |
| `gb-ammo-heavy-rounds` | GB's Heavy Rounds | v1.0.0 |
| `gb-ammo-shells` | GB's Shells | v1.0.0 |
| `gb-ammo-micro-missiles` | GB's Micro Missiles | v1.0.0 |
| `gb-ammo-darts` | GB's Darts | v1.1.0 |
| `gb-ammo-bolts` | GB's Bolts | v1.1.0 |
| `gb-ammo-rail-slugs` | GB's Rail Slugs | v1.1.0 |
| `gb-ammo-cards` | GB's Cards | v1.1.0 |

### Default Weapon Assignments

| Weapon (slug) | Default Ammo Type |
|---------------|------------------|
| crossbolter | Bolts |
| card-slinger | Cards |
| acid-dart-rifle | Darts |
| seeker-rifle, assassin-rifle, shirren-eye-rifle, shobhad-longrifle | Heavy Rounds |
| semi-auto-pistol, rotating-pistol | Light Rounds |
| autotarget-rifle, machine-gun | Medium Rounds |
| reaction-breacher, stellar-cannon, gyrojet-pistol | Micro Missiles |
| coil-rifle, magnetar-rifle | Rail Slugs |
| scattergun, breaching-gun | Shells |

### Ammo Management Menu

**Module Settings → Manage Ammo Types** (GM only). Two tabs:

**Bulk tab**
- **Assign All Custom Ammo Types** — applies all default assignments to every matching weapon in the world and all actor inventories
- **Reset All to Basic Ammo** — resets all configured weapons to `projectile-ammo`, clears overrides

**Individual tab**
- Per-weapon dropdown to override the default ammo type
- Modified rows highlighted until saved
- **Apply Changes** — saves overrides and updates affected weapons
- **Reset Individual to Defaults** — clears all per-weapon overrides

Overrides are stored in the hidden world setting `weaponAmmoOverrides` (slug → ammo type key).

### Compendium Packs

- **Greenbottle's Ammo Belt - Ammunition** — pre-configured ammunition items

### Changelog

| Version | Changes |
|---------|---------|
| 1.1.2.7 | Current stable |
| 1.1.0 | Added darts, bolts, rail slugs, cards ammo types |
| 1.0.0 | Initial release: light/medium/heavy rounds, shells, micro missiles |

---

---

## Greenbottle's Hacking Quips

**Repo:** [greenbottles-hacking-quips](https://github.com/Ayabara1013/greenbottles-hacking-quips) | **v2.1.2**
**Requires:** greenbottles-toolbelt

Three distinct features bundled in one module.

### Feature 1 — Hacking Quips

Watches every chat message for Computers skill checks (SF2e hacking). Detection checks `flags.pf2e.context.skill === 'computers'` or `'cmp'`, or for "computers"/"hacking" in the message flavor.

**With a DC set:** if the roll is a `failure` or `criticalFailure`, a **"Show Hacking Quip"** button appears on the GM's chat message. Clicking it posts a random quip to the player.

**Without a DC (GM adjudicates):** GM adjudication buttons appear below the roll. Selecting a failure result auto-posts a quip. Available buttons depend on settings:
- Default: Critical Success / Success / Failure / Critical Failure
- `hideSuccessButtons`: only Failure + Critical Failure shown
- `simplifiedFailure`: Failure and Critical Failure merged into one button

Quips are whispered to the rolling player and the GM. Button state (removed vs disabled after use) is controlled by `disableInsteadOfRemove`. State is synced across all clients via `game.socket`.

**Settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| Disable Buttons Instead of Removing | `false` | Grey out used buttons instead of removing them |
| Hide Success Buttons | `false` | Only show failure buttons for GM adjudication |
| Simplified Failure Button | `false` | Merge Failure + Critical Failure into one button |

### Feature 2 — Timber Sentinel

Triggers whenever any chat message contains the text **"Timber Sentinel"** (case-insensitive, checks both flavor and content). Posts a random tree or coral species with flavour text.

**Data sources** (loaded from module's `/data/` folder):
- `trees.json` — tree species with flavor text
- `coral.json` — coral species with scientific name, type, flavor, fun facts
- `custom-trees.json` — optional extra trees (merged in if present)
- `custom-coral.json` — optional extra corals (merged in if present)

**Settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| Types: Trees | `true` | Include trees in the random pool |
| Types: Coral | `true` | Include coral in the random pool |
| Simple Name | `false` | Show only the species name, no flavor text |
| Uppercase | `false` | Display the species name in ALL CAPS |
| Emphatic | `false` | Add `!` after the species name |
| Coral: Flavor Text | `true` | Show fantasy-themed flavor sentence for coral |
| Coral: Scientific Name | `true` | Show scientific name below the coral name |
| Coral: Coral Type | `true` | Show type badge (Hard / Soft / Fire / Other Coral) |
| Coral: Fun Facts Button | `true` | Show a 🐚 Fun Facts toggle button with real facts |

### Feature 3 — Knives & Daggers

Compendium roll tables and a macro for rolling random knife/dagger entries from a curated encyclopedia. Detail fields shown per-roll are individually toggleable.

**Settings (all default `true`):** Pronunciation · Category · Origin · Blade · Handle · Description · Uses

### Compendium Packs

- **Knives & Daggers Table** — roll table of knife/dagger encyclopedia entries
- **Timber Sentinel: Trees Table** — roll table of tree species
- **Timber Sentinel: Corals Table** — roll table of coral species
- **Greenbottle's Macros** — utility macros

### Changelog

| Version | Changes |
|---------|---------|
| 2.1.2 | Current stable |
| 2.1.x | Coral support added to Timber Sentinel; per-field detail toggles for coral |
| 1.1.0 | Settings: disable-instead-of-remove, hide success buttons, simplified failure button |
| 1.0.0 | Initial release: 20 hacking quips, GM adjudication controls |

---

---

## Greenbottle's Vitality Network

**Repo:** [greenbottles-vitality-network](https://github.com/Ayabara1013/greenbottles-vitality-network) | **v1.1.0**
**Requires:** greenbottles-toolbelt, pf2e-toolbelt

Automates the SF2e **Transfer Vitality** action: detects when the action is used, prompts the player to spend Vitality Network points, deducts them from the character sheet, and rolls the healing using pf2e-toolbelt's Target Helper to apply it automatically to targeted tokens.

The Vitality Network resource lives on SF2e characters at:
- `actor.system.resources.vitalityNetwork.value` — current points
- `actor.system.resources.vitalityNetwork.max` — maximum points

### How It Works

1. **On Transfer Vitality** — `createChatMessage` hook fires when the action is used. Only the user who owns the acting character sees the spend prompt (other clients skip).
2. **Spend UI** — Player chooses how many points to spend (capped at what they have). Two UI styles available:
   - **Chat card** — whispered interactive card embedded in the chat log
   - **Popup dialog** — Foundry Dialog window
3. **After spending** — deducts points from the actor, optionally posts a spending summary (visibility controlled by `showSpending`), then rolls `N[healing]` and passes it to pf2e-toolbelt's `pf2e-toolbelt.target-helper.damage-received` hook to auto-apply to targeted tokens.

### Per-Turn Vitality Regen

Fires on every `combatTurnChange` for player-owned combatants. Points are added at the start of their turn, capped at max.

| Level | Points Regained per Turn |
|-------|--------------------------|
| 1–14 | +4 |
| 15–18 | +6 |
| 19+ | +8 |

### Settings

| Setting | Scope | Default | Description |
|---------|-------|---------|-------------|
| Dialog Style | Client | `chat` | `popup` dialog or `chat` card for the spend prompt |
| Show Vitality Spending | World | `all` | Who sees the spending summary: `all` / `owner` / `gm` / `owner-gm` / `none` |
| Show Vitality Network Updates | World | `owner` | Who sees per-turn regen notifications: `all` / `owner` / `gm` / `owner-gm` / `none` |
| Update Notification Style | World | `ui` | How regen appears: `ui` (top-right popup) or `chat` message |

### Compendium Packs

- **Greenbottle's Vitality Network - Macros**

### Changelog

| Version | Changes |
|---------|---------|
| 1.1.0 | Chat card UI style; visibility controls for spending/update messages; pf2e-toolbelt Target Helper integration |
| 1.0.0 | Initial release: Transfer Vitality detection, popup dialog, point deduction |

---

**Author:** Doc_ (Greenbottle) · [GitHub](https://github.com/Ayabara1013)
