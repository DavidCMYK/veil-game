// Mobile presentation uses the game's existing menus, dialogue, targeting and input rules.
(() => {
  const root = document.documentElement;
  const game = document.getElementById('gameContainer');
  const make = (tag, id, parent, text) => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (text) el.textContent = text;
    if (parent) parent.append(el);
    return el;
  };
  const button = (label, parent, action) => {
    const b = make('button', null, parent, label); b.type = 'button';
    b.addEventListener('click', e => { e.stopPropagation(); action(); sync(true); });
    return b;
  };
  const send = code => {
    window.dispatchEvent(new KeyboardEvent('keydown', {code, bubbles:true, cancelable:true}));
    window.dispatchEvent(new KeyboardEvent('keyup', {code, bubbles:true, cancelable:true}));
  };
  const toolbar = make('header', 'mobileToolbar', game);
  const menuButton = button('Menu', toolbar, () => {
    if (loading || inConversation || controlsLocked) return;
    if (inManualTargeting) endManualTargeting({ closeAll:true });
    else if (inMenu) closePlayerMenu();
    else { if(mapOverlayOpen) setMapOverlayOpen(false); openPlayerMenu('party'); }
  });
  menuButton.setAttribute('aria-controls', 'mobilePanel');
  const locationLabel = make('div', 'mobileLocation', toolbar);
  const mapButton = button('Map', toolbar, () => send('KeyM'));
  const panel = make('aside', 'mobilePanel', viewportEl);
  panel.setAttribute('aria-label', 'Game information');
  const panelHeader = make('div', 'mobilePanelHeader', panel);
  const heading = make('h2', 'mobilePanelTitle', panelHeader);
  const closeButton = button('Close', panelHeader, () => {
    if (inManualTargeting) endManualTargeting({openMenuPageId:manualTargetingState?.returnPageId || activeMenuPageId});
    else if(mapOverlayOpen) setMapOverlayOpen(false);
    else if(inConversation) { if(!inActionPhrase) cancelConversation(); }
    else closePlayerMenu();
  });
  const actorNav = make('div', 'mobileActorNav', panel);
  const targetPanel = make('div', 'mobileTargetPanel', panel);
  const footer = make('nav', 'mobileActions', game);
  footer.setAttribute('aria-label', 'Available game actions');
  const notice = make('div', 'mobileNotice', footer);
  const hint = make('div', 'mobileMoveHint', footer, 'Drag the scene left or right to move');
  const actions = make('div', 'mobileContextActions', footer);
  // Restore the original DOM positions when a tablet switches to desktop layout.
  const destinations = [
    [menuTopTabs, panel], [playerMenuOverlay, panel],
    [conversationOverlay, panel], [conversationPortrait, panelHeader], [mapOverlayEl, panel], [playerMenuError, footer]
  ].map(([el, parent]) => {
    const marker = document.createComment('desktop position'); el.before(marker);
    return {el, parent, marker};
  });
  playerMenuError.setAttribute('role', 'alert');
  let mounted = false, signature = '', footerSignature = '', navSignature = '';
  let gesture = null, movementCode = null, mapGesture = null;
  function stopMovement() {
    if(movementCode) {
      window.dispatchEvent(new KeyboardEvent('keyup', {code:movementCode, bubbles:true}));
      player.vx = 0;
    }
    movementCode = null;
    keys.ArrowLeft = false; keys.ArrowRight = false;
  }
  function canMove() {
    return !loading && !inMenu && !inConversation && !mapOverlayOpen && !controlsLocked && !isPlayerStunned();
  }
  function mount(enabled) {
    if(enabled === mounted) return;
    stopMovement(); gesture = null;
    mounted = enabled;
    for(const {el,parent,marker} of destinations) {
      if(enabled) parent.append(el); else marker.after(el);
    }
    root.classList.toggle('veil-mobile', enabled);
    signature = ''; navSignature = ''; footerSignature = '';
    requestAnimationFrame(() => { resizeCanvas(); if(inMenu) renderPlayerMenu(); });
  }
  function updateActorNav() {
    const characters = activeMenuPageId === 'npcs';
    const show = inMenu && !inManualTargeting && ['party','npcs'].includes(activeMenuPageId);
    actorNav.hidden = !show;
    if(!show) { navSignature=''; return; }
    const members = characters ? getNpcMenuNames() : [player, ...party].map(a => a.name);
    const selected = characters ? npcMenuSelectedIndex : partyMenuSelectedIndex;
    const cardIndex = characters ? npcMenuCardIndex : partyMenuCardIndex;
    const key=JSON.stringify([characters,members,selected,cardIndex]);
    if(key===navSignature) return;
    navSignature=key; actorNav.replaceChildren();
    const select=make('select',null,actorNav);
    select.setAttribute('aria-label',characters?'Character':'Party member');
    members.forEach((name,i)=>{const o=make('option',null,select,name);o.value=String(i);});
    select.value=String(selected);
    select.addEventListener('change',()=>{
      if(characters) {npcMenuSelectedIndex=Number(select.value);npcMenuCardIndex=0;}
      else {partyMenuSelectedIndex=Number(select.value);partyMenuCardIndex=0;}
      renderPlayerMenu();sync(true);
    });
    const tabs=make('div',null,actorNav);tabs.className='mobileSubTabs';
    ['Stats','Abilities','Inventory','Goals'].forEach((label,i)=>{
      const b=button(label,tabs,()=>{
        if(characters){npcMenuCardIndex=i;npcMenuPrevCardIndex=i;npcMenuCardAnimUntilMs=0;}
        else {partyMenuCardIndex=i;partyMenuPrevCardIndex=i;partyMenuCardAnimUntilMs=0;}
        renderPlayerMenu();
      });
      b.setAttribute('aria-pressed',String(i===cardIndex));
    });
    const detailSelect=make('select',null,actorNav);
    detailSelect.className='mobileDetailSelect';
    detailSelect.setAttribute('aria-label','Character details');
    ['Stats','Abilities','Inventory','Goals'].forEach((label,i)=>{const o=make('option',null,detailSelect,label);o.value=String(i);});
    detailSelect.value=String(cardIndex);
    detailSelect.addEventListener('change',()=>{
      const i=Number(detailSelect.value);
      if(characters){npcMenuCardIndex=i;npcMenuPrevCardIndex=i;npcMenuCardAnimUntilMs=0;}
      else {partyMenuCardIndex=i;partyMenuPrevCardIndex=i;partyMenuCardAnimUntilMs=0;}
      renderPlayerMenu();sync(true);
    });
    if(!characters && selected>0) {
      button('Leave party',actorNav,()=>{removeNpcFromParty(party[selected-1]);partyMenuSelectedIndex=0;renderPlayerMenu();});
    }
  }
  function updateTargets() {
    const st=manualTargetingState;
    const candidates=st?.candidates||[];
    targetPanel.replaceChildren();
    make('p',null,targetPanel,'Tap a target in the scene, or choose one below.');
    const select=make('select',null,targetPanel);select.setAttribute('aria-label','Target');
    candidates.forEach((c,i)=>{const o=make('option',null,select,c.displayName||c.name||c.id||`Target ${i+1}`);o.value=String(i);});
    select.value=String(st?.selectedIndex||0);
    select.addEventListener('change',()=>{if(manualTargetingState) manualTargetingState.selectedIndex=Number(select.value);});
    const confirm=button(st?.kind==='give'?'Give item':'Confirm target',targetPanel,()=>confirmManualTargetingSelection());
    confirm.disabled=!candidates.length;
  }
  function updateActions(mode) {
    const available=[];
    if(mode==='dialogue') {
      if(!inActionPhrase && !(dialogOptionsMap && Object.keys(dialogOptionsMap).length)) available.push(['Continue',()=>send('Space')]);
    } else if(mode==='play' && !loading && !controlsLocked) {
      if(currentObjectInteract || currentItemInteract) available.push(['Interact',()=>send('Space')]);
      if(currentTrigger || activeDialogPrompts.some(p=>p?.npc&&!party.includes(p.npc))) available.push(['Talk',()=>send('KeyT')]);
      if(currentTrigger && canRecruitNpc(currentTrigger)) available.push(['Recruit',()=>send('KeyR')]);
      if(currentExitUp) available.push(['Exit ↑',()=>send('ArrowUp')]);
      if(currentExitDown) available.push(['Exit ↓',()=>send('ArrowDown')]);
      activeDialogPrompts.forEach(p=>{if(p?.npc && party.includes(p.npc) && p.keyNum) available.push([`${p.npc.name}: ${p.prompt||'Talk'}`,()=>send(`Digit${p.keyNum}`)]);});
    }
    const key=JSON.stringify([mode,available.map(a=>a[0])]);
    hint.hidden=mode!=='play';
    if(key===footerSignature) return;
    footerSignature=key; actions.replaceChildren();
    available.forEach(([label,action])=>button(label,actions,action));
  }
  function sync(force=false) {
    mount(window.veilUseMobileLayout());
    if(!mounted) return;
    const mode=inManualTargeting?'target':mapOverlayOpen?'map':inConversation?'dialogue':inMenu?'menu':'play';
    const title=mode==='menu'?(MENU_PAGES.find(p=>p.id===activeMenuPageId)?.label||'Menu'):mode==='dialogue'?(currentDialog?.phrases?.[currentPhraseId]?.speaker || currentNpc?.name || 'Story'):mode==='map'?'Map':'Choose a target';
    const key=JSON.stringify([mode,title,currentPhraseId,activeMenuPageId,partyMenuSelectedIndex,npcMenuSelectedIndex,partyMenuCardIndex,npcMenuCardIndex]);
    if(force || key!==signature) {
      signature=key; root.dataset.mobileMode=mode;
      root.classList.toggle('mobile-panel-open',mode!=='play');
      heading.textContent=title;
      closeButton.textContent=mode==='target'?'Back':'Close';
      closeButton.disabled=inActionPhrase;
      menuButton.setAttribute('aria-expanded',String(mode==='menu'));
      targetPanel.hidden=mode!=='target';
      if(mode==='target') updateTargets();
      stopMovement();
    }
    menuButton.disabled=loading||inConversation||controlsLocked;
    mapButton.disabled=loading||inConversation||inMenu||controlsLocked;
    const time=__getTimeInfoForVisuals();
    const toast=WORLD_TOASTS[WORLD_TOASTS.length-1];
    notice.textContent=toast?.text || '';
    notice.hidden=!toast;
    locationLabel.textContent=`${currentArea?.displayName||currentArea?.name||currentAreaName||'Veil'} · ${time.phase||''}`;
    updateActorNav();updateActions(mode);
    // Keep the movement viewport the same size when an overlay opens or closes.
    footer.hidden = false;
  }
  canvas.addEventListener('pointerdown',e=>{
    if(!mounted || e.pointerType==='mouse' && !new URLSearchParams(location.search).has('touch')) return;
    if(gesture || e.isPrimary===false) return;
    e.preventDefault();canvas.setPointerCapture(e.pointerId);
    gesture={id:e.pointerId,x:e.clientX,y:e.clientY,dragged:false};
  });
  canvas.addEventListener('pointermove',e=>{
    if(!gesture || gesture.id!==e.pointerId) return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(Math.hypot(dx,dy)>12) gesture.dragged=true;
    if(!canMove()) {stopMovement();return;}
    const code=Math.abs(dx)>12?(dx<0?'ArrowLeft':'ArrowRight'):null;
    if(code===movementCode) return;
    stopMovement(); movementCode=code;
    if(code) window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,cancelable:true}));
  });
  canvas.addEventListener('pointerup',e=>{
    if(!gesture || gesture.id!==e.pointerId) return;
    const tapped=!gesture.dragged;gesture=null;stopMovement();e.preventDefault();
    if(!tapped || loading) return;
    if(inConversation) {if(!inActionPhrase && !(dialogOptionsMap && Object.keys(dialogOptionsMap).length)) send('Space');}
    else if(inManualTargeting || canMove()) handleWorldPointerDown(e);
  });
  const cancelGesture=()=>{gesture=null;stopMovement();};
  canvas.addEventListener('pointercancel',cancelGesture);
  canvas.addEventListener('lostpointercapture',cancelGesture);
  mapCanvas.addEventListener('pointerdown',e=>{
    if(!mounted) return;e.preventDefault();mapCanvas.setPointerCapture(e.pointerId);
    mapGesture={id:e.pointerId,x:e.clientX,y:e.clientY};
  });
  mapCanvas.addEventListener('pointermove',e=>{
    if(!mapGesture||mapGesture.id!==e.pointerId) return;
    mapPanX+=e.clientX-mapGesture.x;mapPanY+=e.clientY-mapGesture.y;
    mapGesture.x=e.clientX;mapGesture.y=e.clientY;
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) mapCanvas.addEventListener(type,()=>{mapGesture=null;});
  window.addEventListener('blur',cancelGesture);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});
  window.addEventListener('resize',()=>{cancelGesture();sync(true);});
  new ResizeObserver(()=>{
    resizeCanvas();
    if(inManualTargeting) applyManualTargetingCamera(manualTargetingState);
    else if(inMenu) renderPlayerMenu();
  }).observe(viewportEl);
  const dialogueObserver=new MutationObserver(()=>{
    if(!mounted) return;
    // Keep the current phrase and its choices in view as the text is typed.
    if(isTypingDialog) {
      const stack=document.getElementById('dialogStackContainer');
      if(stack) stack.scrollTop=stack.scrollHeight;
    }
  });
  dialogueObserver.observe(conversationOverlay,{childList:true,characterData:true,subtree:true});
  setInterval(sync,120);sync();
})();
