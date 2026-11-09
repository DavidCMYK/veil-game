// Feed touch controls through the same input path as the keyboard.
(() => {
  if (new URLSearchParams(location.search).get('touch') === '1') document.documentElement.classList.add('touch-enabled');
  const controls = document.createElement('nav');
  controls.id = 'touchControls';
  controls.setAttribute('aria-label', 'Game controls');
  const held = new Map();
  const send = (type, code, shiftKey = false) => window.dispatchEvent(new KeyboardEvent(type, {code, shiftKey, bubbles: true, cancelable: true}));
  const release = id => {
    const code = held.get(id);
    if (code) { send('keyup', code); held.delete(id); }
  };
  function button(label, code, group) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      held.set(e.pointerId, code);
      send('keydown', code);
    });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) b.addEventListener(event, e => release(e.pointerId));
    group.append(b);
    return b;
  }
  const movement = document.createElement('div'); movement.className = 'touchMovement';
  button('Left', 'ArrowLeft', movement); button('Right', 'ArrowRight', movement);
  button('Up', 'ArrowUp', movement); button('Down', 'ArrowDown', movement);
  const actions = document.createElement('div'); actions.className = 'touchActions';
  button('Jump / Interact', 'Space', actions);
  button('Talk / Continue', 'KeyT', actions);
  button('Recruit', 'KeyR', actions);
  button('Party', 'KeyP', actions); button('Map', 'KeyM', actions); button('Close', 'KeyX', actions);
  const choices = document.createElement('div'); choices.className = 'touchChoices';
  const choiceButtons = [];
  for (let n=1;n<=9;n++) choiceButtons.push(button(String(n), `Digit${n}`, choices));
  controls.append(movement, choices, actions); document.body.append(controls);
  function updateChoices() {
    const slots = new Set();
    if (inConversation && dialogOptionsMap) for (const n of Object.keys(dialogOptionsMap)) slots.add(Number(n));
    if (!inConversation) for (const p of activeDialogPrompts) if (p && party.includes(p.npc)) slots.add(p.keyNum);
    choiceButtons.forEach((b,i) => { b.hidden = !slots.has(i+1); });
  }
  setInterval(updateChoices, 200);
  function releaseAll() {
    for (const id of [...held.keys()]) release(id);
    for (const code of Object.keys(keys)) keys[code] = false;
  }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if(document.hidden) releaseAll(); });
  // Avoid scrolling the browser when keyboard arrows or Space control the game.
  window.addEventListener('keydown', e => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  });
})();
