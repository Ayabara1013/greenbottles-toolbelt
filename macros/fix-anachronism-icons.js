/**
 * SF2e Anachronism v2.0 Icon Migration
 *
 * The v2.0.0 update to sf2e-anachronism removed the art/icons folder and moved
 * all icons to systems/pf2e/icons/. Run this macro once as GM to update any
 * world items and actor items that still reference the old path.
 *
 * Safe to run multiple times — items already on the new path are skipped.
 */

const OLD_PREFIX = 'modules/sf2e-anachronism/art/icons/';
const NEW_PREFIX = 'systems/pf2e/icons/';

function fixPath(path) {
  if (typeof path === 'string' && path.startsWith(OLD_PREFIX)) {
    return NEW_PREFIX + path.slice(OLD_PREFIX.length);
  }
  return path;
}

async function fixActorDocs(actor) {
  const actorUpdate = {};

  const newImg = fixPath(actor.img);
  if (newImg !== actor.img) {
    actorUpdate.img = newImg;
    counts.actorImages++;
  }

  const tokenSrc = actor.prototypeToken?.texture?.src;
  const newTokenSrc = fixPath(tokenSrc);
  if (newTokenSrc !== tokenSrc) {
    actorUpdate['prototypeToken.texture.src'] = newTokenSrc;
  }

  if (Object.keys(actorUpdate).length > 0) {
    await actor.update(actorUpdate);
  }

  const itemUpdates = [];
  for (const item of actor.items) {
    const newItemImg = fixPath(item.img);
    if (newItemImg !== item.img) {
      itemUpdates.push({ _id: item.id, img: newItemImg });
      counts.actorItems++;
    }
  }
  if (itemUpdates.length > 0) {
    await actor.updateEmbeddedDocuments('Item', itemUpdates);
  }
}

const counts = { worldItems: 0, actorItems: 0, actorImages: 0, tokenItems: 0, tokenImages: 0 };

// ── World items ──────────────────────────────────────────────────────────────
for (const item of game.items) {
  const newImg = fixPath(item.img);
  if (newImg !== item.img) {
    await item.update({ img: newImg });
    counts.worldItems++;
  }
}

// ── World actors + their embedded items ─────────────────────────────────────
for (const actor of game.actors) {
  await fixActorDocs(actor);
}

// ── Unlinked scene tokens + their embedded items ─────────────────────────────
// Unlinked tokens maintain their own actor data independent of game.actors.
for (const scene of game.scenes) {
  for (const tokenDoc of scene.tokens) {
    if (tokenDoc.isLinked) continue; // linked tokens use the world actor — already covered

    const tokenUpdate = {};
    const newSrc = fixPath(tokenDoc.texture?.src);
    if (newSrc !== tokenDoc.texture?.src) {
      tokenUpdate['texture.src'] = newSrc;
      counts.tokenImages++;
    }
    if (Object.keys(tokenUpdate).length > 0) {
      await tokenDoc.update(tokenUpdate);
    }

    const actor = tokenDoc.actor;
    if (!actor) continue;
    const itemUpdates = [];
    for (const item of actor.items) {
      const newItemImg = fixPath(item.img);
      if (newItemImg !== item.img) {
        itemUpdates.push({ _id: item.id, img: newItemImg });
        counts.tokenItems++;
      }
    }
    if (itemUpdates.length > 0) {
      await actor.updateEmbeddedDocuments('Item', itemUpdates);
    }
  }
}

const summary = [
  counts.worldItems  ? `${counts.worldItems} world items`     : null,
  counts.actorItems  ? `${counts.actorItems} actor items`      : null,
  counts.actorImages ? `${counts.actorImages} actor portraits`  : null,
  counts.tokenItems  ? `${counts.tokenItems} token items`       : null,
  counts.tokenImages ? `${counts.tokenImages} token images`     : null,
].filter(Boolean).join(', ');

if (summary) {
  ui.notifications.info(`SF2e icon fix complete: updated ${summary}.`);
  console.log(`SF2e Anachronism Icon Fix | Updated: ${summary}`);
} else {
  ui.notifications.info('SF2e icon fix: nothing to update — all icons already on the new path.');
}
