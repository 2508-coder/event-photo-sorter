// Free, instant caption generator — composes a caption from the AI signals we
// already compute (category, number of faces, dominant emotion). No extra model.
const BY_CATEGORY = {
  Lecture: ["Back to the grind 📚", "Lecture mode: on", "Notes & caffeine ☕"],
  "Lab Work": ["Lab day 🔬", "Science in action", "Experiment hours"],
  Graduation: ["We made it! 🎓", "Caps off to us", "Officially graduated 🎓"],
  Campus: ["Campus vibes", "Home base 🏛️", "Where it all happens"],
  Sports: ["Game on! 🏆", "Left it all on the field", "Sports day energy ⚡"],
  Fest: ["Fest mode 🎉", "Best night ever ✨", "Lights, music, college 🎶"],
  People: ["Good company ❤️", "These people", "Squad spotted"],
  Food: ["Fuel ⛽🍕", "Campus eats", "Worth every calorie"],
  Documents: ["Saving this for later 📄", "Important notes"],
  Screenshots: ["Saved for later", "Note to self"],
  Other: ["A moment worth keeping", "Captured 📸"],
};

export function makeCaption({ category, faceCount, emotion }) {
  const base = BY_CATEGORY[category] || BY_CATEGORY.Other;
  let cap = base[Math.floor(Math.random() * base.length)];
  if (faceCount >= 3) cap += " #squadgoals";
  if (emotion === "happy") cap += " 😄";
  else if (emotion === "surprised") cap += " 😮";
  return cap;
}
