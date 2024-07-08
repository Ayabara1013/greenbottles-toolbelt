Hooks.once('init', async function () {
  console.log("Greenbottle's Toolbelt | Initializing greenbottles-toolbelt")
});

const settings = 

/**
 * game.actors.party
 */
  
// define a function to sell all marked items
async function SellMarkedItems() {
  const actor = game.actors.getName('Actor.xxxPF2ExPARTYxxx')
  }



// option a


const inventory = game.actors.party.inventory;
const itemsToSell = [];
const sellRatio = 0.5;
const totalSale = 0

inventory.forEach(item => {
  if (item.sellAll === true) {
    totalSale += item.value * sellRatio;
    inventory.deleteItem(item)
  }
});

game.actors.party.gold += totalSale;




// game.settings.register('custom-item-checkbox', 'partySheetActorId', {
//   name
// })

// macro

junkBag = game.party.inventory[junkBag];

for (item in junkBag) {
  if (item.fundamentalRunes === false) {
    totalSale += item.value * sellRatio;
    deleteItem(item)
  }
}




// on "/sellAll"


const sellAllWindow = <div>
{listAllItems(game.actors.party.inventory)}
</div>

const listAllItems = (inventory) => {
  const windowList = [];

  for (let index = 0; index < inventory.length(); index++) {
    windowList += windowItem(item, index);
  }

  return windowList;
}

const windowItem = (item, index) => {
  returns(
    <div index={index}>
      <div>{item.name}</div>
      <div>{item.value}</div>
      <div>{item.return}</div>
      <div onclick={}>{checkbox}</div>
    </div>
  )
}
createWindow(sellAllWindow)