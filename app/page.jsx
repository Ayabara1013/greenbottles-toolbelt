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

  return (
    <div className='flex min-h-screen flex-col py-2'>
      <h1 className='text-4xl'>greenbottle's toolbelt</h1>

      <div className='creature-generator border p-2'>
        <div>creature generator</div>

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
      const id = `${part}${index + 1}`;
      // const buttonId = index + 1;
      // const isActive = buttonStates[part][buttonId];

      return (
        <button
          key={id}
          id={id}
          className={`btn ${buttonStates[id] ? '' : 'btn-soft'} btn-primary`}
          onClick={() => 
            setButtonStates(prev => ({
              ...prev,
              [id]: !prev[id]
            }))
          }
        >
          {`${index + 1}: ${name}`}
        </button>
      )
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

