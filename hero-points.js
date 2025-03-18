

Hooks.on("getSceneControlButtons", controls => {
	if (!game.user.isGM) return; // Only GMs can see and use this button

	const tokenControls = controls.find(control => control.name === "token"); // Locate the Token Controls section
	if (!tokenControls) {
		console.error("Token controls not found!");
		return;
	}

	// 	// Get the party members from the Pathfinder 2e system
	// const party = game.actors.party?.members;

	// if (!party || party.length === 0) {
	// 	ui.notifications.warn("No party members found in the Pathfinder 2e party!");
	// 	console.error("No party members found in the Pathfinder 2e party!");
	// 	return;
	// }

	tokenControls.tools.push({
		name: "heroPoints",
		title: "Assign Hero Points", // Tooltip text
		icon: "fas fa-star", // Font Awesome star icon
		onClick: () => openHeroPointsDialog(),
		button: true
	});

	// Button for listing party members in the chat
	tokenControls.tools.push({
		name: "listPartyMembers",
		title: "List Party Members", // Tooltip text
		icon: "fas fa-users", // Font Awesome group/users icon
		onClick: () => listPartyMembersInChat(), // Lists party members in the chat
		button: true
	});

	console.log("Hero Points and List Party Members buttons added!");
});




// Function to open the dialog box
function openHeroPointsDialog() {
	// Get the party members from the Pathfinder 2e system
	const party = game.actors.party?.members;

	if (!party || party.length === 0) {
		ui.notifications.warn("No party members found in the Pathfinder 2e party!");
		console.error("No party members found in the Pathfinder 2e party!");
		return;
	}

	new Dialog({
		title: "Assign Hero Points",
		content: `<p>How many hero points should party members receive?</p>`,
		buttons: {
			one: {
				label: "add 1",
				callback: () => updateHeroPoints(1, party, 'add') // Assign 1 hero point to party members
			},
			two: {
				label: "set all to 2",
				callback: () => updateHeroPoints(2, party, 'set') // Assign 2 hero points to party members
			},
			three: {
				label: "top up",
				callback: () => updateHeroPoints(2, party, 'top-up') // Assign 3 hero points to party members
			},
			four: {
				label: "clear",
				callback: () => updateHeroPoints(0, party, 'set') // Assign 3 hero points to party members
			}
		},
		default: "two" // Default button selected
	}).render(true);

	console.log("Hero Points dialog opened!");
}



// Function to assign Hero Points to party members only
function updateHeroPoints(amount, party, type) {


	for (const member of party) {

		console.log(member.prototypeToken.name);
		let heropoints = member.system.resources.heroPoints.value;

		// if (heropoints >= member.system.resources.heroPoints.max) {
		// 	ui.notifications.info(`${member.prototypeToken.name || 'NAME'} is already at the max hero points`);
		// 	heropoints = 0;
		// }
		
		if (type === 'add') {
			if (heropoints >= member.system.resources.heroPoints.max) {
				ui.notifications.info(`${member.prototypeToken.name || 'NAME'} is already at the max hero points`);
				heropoints = 0;
				continue;
			}

			const newAmount = heropoints += amount;

			member.update({
				'system.resources.heroPoints.value': newAmount
			}).then(() => {
					ui.notifications.info(`${member.prototypeToken.name}'s Hero Points have been updated to ${newAmount}`);
			}).catch(error => {
					console.error(`Failed to update Hero Points for ${member.prototypeToken.name}:`, error);
					ui.notifications.error(`Failed to update Hero Points for ${member.prototypeToken.name}`);
			});
		}	

		else if (type === 'set') {
			member.update({
				'system.resources.heroPoints.value': amount
			}).then(() => {
					ui.notifications.info(`${member.prototypeToken.name}'s Hero Points have been updated to ${amount}`);
			}).catch(error => {
					console.error(`Failed to update Hero Points for ${member.prototypeToken.name}:`, error);
					ui.notifications.error(`Failed to update Hero Points for ${member.prototypeToken.name}`);
			});
		}
			
		else if (type === 'top-up') {
			// Logic to check if an update is needed
			if (heropoints >= amount) {
        ui.notifications.info(`${member.prototypeToken.name} already has enough Hero Points!`);
				continue; // Skip to the next member if no update is needed
			}	

			// Prepare the update object
			const updateData = {
        'system.resources.heroPoints.value': amount
			};
			
			member.update(updateData)
				.then(() => {
					ui.notifications.info(`${member.prototypeToken.name}'s Hero Points have been updated to ${amount}`);
				}).catch(error => {
						console.error(`Failed to update Hero Points for ${member.prototypeToken.name}:`, error);
						ui.notifications.error(`Failed to update Hero Points for ${member.prototypeToken.name}`);
				});
		}
			
		else {
			ui.notifications.error(`something went wrong!`);
		}

		// return;
	}
}


function listPartyMembersInChat() {
	// Get the party members from the Pathfinder 2e system
	const partyMembers = game.actors.party?.members;

	if (!partyMembers || partyMembers.length === 0) {
		ui.notifications.warn("No party members found in the Pathfinder 2e party!");
		console.error("No party members found in the Pathfinder 2e party!");
		return;
	}

	// Build the HTML message to display in chat
	let messageContent = `
		<h2>Party Members</h2>
		<table style="width: 100%; text-align: left; border-collapse: collapse;">
			<thead>
				<tr>
					<th style="border-bottom: 1px solid #ddd;">Name</th>
					<th style="border-bottom: 1px solid #ddd;">Level</th>
					<th style="border-bottom: 1px solid #ddd;">Class</th>
					<th style="border-bottom: 1px solid #ddd;">Hero Points</th>
				</tr>
			</thead>
			<tbody>
	`;

	for (const actor of partyMembers) {
			// Access actor data for level and class
		const level = actor.system?.details?.level?.value || "N/A";	

		const className = actor.items.find(item => item.type === 'class')?.name || 'N/A';

			messageContent += `
				<tr>
					<td>${actor.prototypeToken.name}</td>
					<td>${level}</td>
					<td>${className}</td>
					<td>${actor.system.resources.heroPoints.value}/${actor.system.resources.heroPoints.max}</td>
				</tr>
			`;
	}

	messageContent += `
			</tbody>
		</table>
	`;

	// Send the message to chat
	ChatMessage.create({
			content: messageContent,
			speaker: { alias: "Party Tool" }
	});

	console.log("Party Members listed in chat!");
}

// Call the function immediately so you can run it directly in the console
// updateHeroPoints(1, game.actors.party?.members, 'add');

openHeroPointsDialog()
// listPartyMembersInChat();