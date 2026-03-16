# Greenbottle's Toolbelt — Dev Log

---

## Session 1 — Foundation Setup
*March 2026*

### What we built

#### The problem we were solving
You have several Foundry modules (hacking-quips, vitality-network, hero-points, ammo-belt) and they all had copy-pasted versions of the same boring code — things like "look up an actor's resource value", "find all items in the world", "load a JSON file". Every time you'd fix a bug in that code in one module, you'd have to remember to fix it in all the others too. That's a pain.

The fix: pull all that shared code into one place — this module, Greenbottle's Toolbelt — and have everything else use it.

---

#### Step 1: This module existed but was basically empty and broken
The `greenbottles-toolbelt` repo existed but the `module.json` file still had the wrong name on it — it said it was `greenbottles-hacking-quips` instead of `greenbottles-toolbelt`. The main script file (`toolbelt.js`) was completely blank.

**What we did:** Fixed the `module.json` so it correctly identifies itself as `greenbottles-toolbelt`, updated all the URLs to point at the right GitHub repo, and created an empty CSS file as a placeholder for future styles.

---

#### Step 2: Built the shared utility library
We wrote the actual code in `scripts/toolbelt.js`. Think of it like a toolbox — you put useful tools in it once, and then any of your modules can reach in and grab one.

The tools we added:

- **`getActorResource`** — Looks up a value buried deep inside a character sheet. Instead of writing `actor.system.resources.heroPoints.value` every time, you just say "get me the heroPoints value for this actor."

- **`updateActorResource`** — Changes a value on a character sheet safely. It automatically makes sure you can't go below 0 or above the max, and shows a little notification message when it works. Before this, vitality-network and hero-points both had their own version of this same logic.

- **`findWorldItems`** — Searches for items everywhere: both in the world item list AND inside every character's inventory. Ammo-belt had this written out twice in its own code; now it can use this instead.

- **`loadModuleData`** — Loads a JSON data file for a module. Also supports a "custom" override file — if you have a `custom-trees.json` sitting next to the default `trees.json`, it merges them together. Hacking-quips was already doing this manually; this wraps it up cleanly.

- **`isModuleActive`** — Simple yes/no check: "is this other module installed and turned on?"

- **`registerSetting` / `getSetting` / `setSetting`** — Thin wrappers around Foundry's built-in settings functions. Mostly for convenience and so all modules talk to settings the same way.

Everything is accessed via: `game.modules.get('greenbottles-toolbelt').api`

---

#### Step 3: Told all the other modules "you need this now"
We updated the `module.json` of every dependent module to say that Greenbottle's Toolbelt is a required dependency. That means Foundry will warn users if they try to run one of your modules without the toolbelt installed.

- `greenbottles-hacking-quips` — added dependency
- `greenbottles-vitality-network` — added dependency
- `greenbottles-toolbelt__hero-points` — added dependency (also fixed a broken manifest URL that was pointing at the wrong repo)
- `greenbottles-ammo-belt` — added dependency alongside its existing `sf2e-anachronism` dependency

---

#### Step 4: Moved all compendium packs into one sidebar folder
In Foundry's compendium sidebar, packs from different modules were scattered all over the place. Ammo-belt and vitality-network were already grouped under a "Greenbottle's Toolbelt" folder, but hacking-quips' four packs (Knives & Daggers, Trees Table, Corals Table, Macros) were floating loose.

We added a `packFolders` entry to hacking-quips' `module.json` so all four of those packs now join the same folder. Foundry automatically merges same-named folders from different modules into one, so everything shows up together.

---

#### What's next (future sessions)
The dependency is wired up but the modules aren't actually *using* the toolbelt utilities yet — they still have their own copies of the old code. The next step is to go into each module and swap out the duplicated logic for calls to `GBToolbelt`:

| Module | What to replace |
|--------|----------------|
| ammo-belt | Replace the "find items in world + actors" code (written twice) with `GBToolbelt.findWorldItems()` |
| vitality-network | Replace the actor update logic with `GBToolbelt.updateActorResource()` |
| hero-points | Replace the hero point update logic with `GBToolbelt.updateActorResource()` |
| hacking-quips | Replace `TimberSentinel.loadResources()` with `GBToolbelt.loadModuleData()` |

---

### Branches created this session
| Repo | Branch |
|------|--------|
| greenbottles-toolbelt | `feature/shared-utility-library` |
| greenbottles-vitality-network | `feature/toolbelt-dependency` |
| greenbottles-toolbelt__hero-points | `feature/toolbelt-dependency` |
| greenbottles-ammo-belt | `feature/toolbelt-dependency` |
| greenbottles-hacking-quips | `claude/affectionate-hawking` |
