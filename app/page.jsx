"use client";

import Image from "next/image";
import { React, useState} from "react";
// import { useState } from "react";
import "./../styles/globals.scss";

export default function App() {
  // const [buttonStates, setButtonStates] = useState({
  //   btn1: false,
  //   btn2: false,
  //   btn3: false,
  // });

  const [buttonStates, setButtonStates] = useState({});

  // const flipButtonState = (button) => {
  //   setButtonStates((prevStates) => ({
  //     ...prevStates,
  //     [button]: !prevStates[button],
  //   }));
  // }

  const getCreature = () => {
  const selectedParts = {};
  // for (const part in buttonStates) {
  //   const selectedButton = Object.keys(buttonStates[part]).find(key => buttonStates[part][key]);
  //   if (selectedButton) {
  //     const partIndex = parseInt(selectedButton, 10) - 1; // Convert to zero-based index
  //     selectedParts[part] = parts[part][partIndex];
  //   } else {
  //     selectedParts[part] = null; // No selection for this part
  //   }
    // }
    for (const part in buttonStates) {
      if (buttonStates[part] ) {
        console.log('...');
      }
      const selectedButton = Object.keys(buttonStates[part]).find(key => buttonStates[part][key]);
      // console.log(selectedButton);

      if (selectedButton) {
        const partIndex = parseInt(selectedButton, parts[part].length) - 1;
        console.log(partIndex);
        selectedParts[part] = parts[part][partIndex];
      }
      else {
        selectedParts[part] = null; // No selection for this part
      }
    }

    const partsArray = Object.keys(selectedParts).map(key => [key, selectedParts[key]]);
    console.log(partsArray);

    // I want to make it so that it only includes the parts that have been selected
    const filteredPartsArray = partsArray.filter(([key, value]) => value !== null);
    console.log(filteredPartsArray);

    // now I need to make the string for each part
    const partsStringArray = filteredPartsArray.map(([key, value]) => `the ${key} of a ${value}`);
    console.log(partsStringArray);

    // now I need to join the array into a string with commas and "and" before the last item
    const partsString = partsStringArray.join(', ').replace(/, ([^,]*)$/, ' and $1'); // how does this line work??? wtf
    console.log(partsString);

    // finally, I need to make the final string
    const finalString = `you have created a creature with ${partsString}.`;
    console.log(finalString);

    // console.log(selectedParts);
    // console.log(
    //   `you have created a creature with ${selectedParts.head ?? `the head of a ${selectedParts.head}`}, ${`the body of a ${selectedParts.body}`}, ${`the arms of a ${selectedParts.arms}`}, ${`the legs of a ${selectedParts.legs}`}, ${`the tail of a ${selectedParts.tail}`}, and ${`the wings of a ${selectedParts.wings}`}`
    // );
    return selectedParts;
    
  // console.log(buttonStates);
  // return selectedParts;
}

// console.log(getCreature(buttonStates));



  return (
    <div className='flex min-h-screen flex-col py-2'>
      <h1 className='text-4xl'>greenbottle's toolbelt</h1>

      <div className='creature-generator border p-2'>
        <div>creature generator</div>

        <button
          className="btn btn-primary"
          onClick={() => {
            let creature = getCreature(buttonStates);

            // console.log(creature.head);
          }}
            let >
          generate
        </button>

        <div className="flex p-2 gap-2">
          <PartsColumnElement
            part='head'
            partNames={parts.head}
            buttonStates={buttonStates}
            setButtonStates={setButtonStates}
          />

          <PartsColumnElement
            part='body'
            partNames={parts.body}
            buttonStates={buttonStates}
            setButtonStates={setButtonStates}
          />

          <PartsColumnElement
            part='arms'
            partNames={parts.arms}
            buttonStates={buttonStates}
            setButtonStates={setButtonStates}
          />

          <PartsColumnElement
            part='legs'
            partNames={parts.legs}
            buttonStates={buttonStates}
            setButtonStates={setButtonStates}
          />

          <PartsColumnElement
            part='tail'
            partNames={parts.tail}
            buttonStates={buttonStates}
            setButtonStates={setButtonStates}
          />

          <PartsColumnElement
            part='wings'
            partNames={parts.wings}
            buttonStates={buttonStates}
            setButtonStates={setButtonStates}
          />
        </div>
      </div>

    </div>
  )
}

const getButtonNumber = (id) => {
  const match = id.match(/\d+$/);
  const numbertsAtEnd = match ? match[0] : null;
  return numbertsAtEnd;
}

const getPartName = (id) => {
  const match = id.match(/^(.*?)(\d+)?$/);
  // match[1] is everything before the numbers at the end
  return match ? match[1] : id;
}

const PartsColumnElement = ({ part, partNames, buttonStates, setButtonStates }) => (
  <div className='flex flex-col p-2 gap-2'>
    <div>{part}</div>
    <PartsButtonGroup
      part={part}
      partNames={partNames}
      buttonStates={buttonStates}
      setButtonStates={setButtonStates}
    />
  </div>
)

const PartsButtonGroup = ({ part, partNames, buttonStates, setButtonStates }) => (
  <>
    {partNames.map((name, index) => {
      const buttonId = index + 1;
      const isActive = buttonStates[part]?.[buttonId] || false;
      
      return (
        <button
          key={buttonId}
          className={`btn ${!isActive ? 'btn-soft' : ''} btn-primary`}
          onClick={() =>
            setButtonStates(prev => ({
              ...prev,
              [part]: {
                [buttonId]: !isActive  // Toggle this button, all others become undefined/false
              }
            }))
          }
        >
          {`${buttonId}: ${name}`}
        </button>
      );
    })}
  </>
)



const parts = {
  head: [
    "Lion", "Wolf", "Owl", "Crocodile", "Rabbit",
    "Horse", "Panther", "Goat", "Falcon", "Elephant"
  ],
  body: [
    "Tiger", "Canine", "Bear", "Bird", "Lizard",
    "Horse", "Giraffe", "Rhino", "Kangaroo", "Otter"
  ],
  arms: [
    "Eagle", "Gorilla", "Crab", "Snake", "Kangaroo",
    "Octopus", "Mole", "Bat", "Praying Mantis", "Human"
  ],
  legs: [
    "Horse", "Frog", "Elephant", "Cheetah", "Kangaroo",
    "Goat", "Chicken", "Lizard", "Rabbit", "Bear"
  ],
  tail: [
    "Monkey", "Lion", "Scorpion", "Fish", "Fox",
    "Rat", "Horse", "Peacock", "Dog", "Cat"
  ],
  wings: [
    "Eagle", "Bat", "Butterfly", "Dragonfly", "Bee",
    "Owl", "Swan", "Parrot", "Moth", "Pigeon"
  ]
};

