'use strict';
(() => {
  const KEY = 'aiv.castleSidebarSplit.v1';
  function normalize(value) {
    const ratio = Number(value?.ratio);
    return { ratio: Number.isFinite(ratio) ? Math.max(.1,Math.min(.9,ratio)) : .6,
      collapsed: ['top','bottom'].includes(value?.collapsed) ? value.collapsed : null };
  }
  function drag(value, y, height) {
    const state = normalize(value);
    if (!(height > 0)) return state;
    if (y <= 24) return {...state,collapsed:'top'};
    if (y >= height-24) return {...state,collapsed:'bottom'};
    return normalize({ratio:y/height});
  }
  function toggle(value, part) {
    const state = normalize(value);
    return {...state,collapsed:state.collapsed===part ? null : part};
  }
  const api = {normalize,drag,toggle};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window === 'undefined') return;
  const panels = new Map();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* defaults */ }
  function attach(panel, key, title) {
    if (!panel) return;
    const top = document.createElement('div'); top.className = 'castleSidebarMain'; top.id = `castleSidebar-${key}-main`;
    const bottom = document.createElement('div'); bottom.className = 'castleSidebarOverviews'; bottom.id = `castleSidebar-${key}-overviews`;
    for (const child of [...panel.children]) (child.matches('.castleOverviewPanel') ? bottom : top).appendChild(child);
    const bar = document.createElement('div'); bar.className = 'castleSidebarDivider';
    const topButton = document.createElement('button'); topButton.type = 'button'; topButton.setAttribute('aria-controls',top.id);
    const bottomButton = document.createElement('button'); bottomButton.type = 'button'; bottomButton.setAttribute('aria-controls',bottom.id);
    const grip = document.createElement('div'); grip.className = 'castleSidebarGrip'; grip.tabIndex = 0;
    grip.setAttribute('role','separator'); grip.setAttribute('aria-orientation','horizontal');
    grip.setAttribute('aria-label',`Resize ${title.toLowerCase()} and overview`);
    grip.setAttribute('aria-controls',`${top.id} ${bottom.id}`);
    grip.setAttribute('aria-valuemin','0'); grip.setAttribute('aria-valuemax','100');
    grip.title = 'Drag to resize; drag to either end to collapse. Arrow keys resize; Home/End collapse; Enter restores.';
    bar.append(topButton,grip,bottomButton); panel.append(top,bar,bottom);
    panel.classList.add('castleSidebarSplit');
    let state = normalize(saved[key]), gesture = null;
    function refresh() {
      const hasOverview = [...bottom.children].some(child => !child.hidden);
      const collapsed = hasOverview ? state.collapsed : 'bottom';
      bar.hidden = !hasOverview;
      top.hidden = collapsed === 'top'; bottom.hidden = collapsed === 'bottom';
      const ratio = collapsed === 'top' ? 0 : collapsed === 'bottom' ? 1 : state.ratio;
      panel.style.gridTemplateRows = `minmax(0, ${ratio}fr) ${hasOverview?'auto':'0px'} minmax(0, ${1-ratio}fr)`;
      topButton.textContent = `${title} ${collapsed==='top'?'\u25bc':'\u25b2'}`;
      bottomButton.textContent = `Overview ${collapsed==='bottom'?'\u25b2':'\u25bc'}`;
      for (const [button,part,label] of [[topButton,'top',title],[bottomButton,'bottom','overview']]) {
        button.title = `${collapsed===part?'Show':'Hide'} ${label.toLowerCase()}`;
        button.setAttribute('aria-label',button.title);
        button.setAttribute('aria-expanded',String(collapsed!==part));
      }
      grip.setAttribute('aria-valuenow',String(Math.round(100*ratio)));
    }
    function persist() {
      saved[key] = state;
      try { localStorage.setItem(KEY,JSON.stringify(saved)); } catch { /* current window still works */ }
    }
    function change(part) { state=toggle(state,part);refresh();persist(); }
    topButton.addEventListener('click',()=>change('top'));
    bottomButton.addEventListener('click',()=>change('bottom'));
    grip.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault(); gesture={id:event.pointerId,before:{...state}};
      grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener('pointermove',event=>{
      if(!gesture || gesture.id!==event.pointerId)return;
      const box=panel.getBoundingClientRect();
      state=drag(state,event.clientY-box.top-bar.offsetHeight/2,box.height-bar.offsetHeight);
      refresh();
    });
    function finish(event,cancel=false) {
      if(!gesture || gesture.id!==event.pointerId)return;
      if(cancel)state=gesture.before;
      gesture=null;refresh();persist();
    }
    grip.addEventListener('pointerup',event=>finish(event));
    grip.addEventListener('pointercancel',event=>finish(event,true));
    grip.addEventListener('lostpointercapture',event=>finish(event));
    grip.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home','End','Enter'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      if(event.key==='Home')state={...state,collapsed:'top'};
      else if(event.key==='End')state={...state,collapsed:'bottom'};
      else if(event.key==='Enter')state={...state,collapsed:null};
      else state=normalize({ratio:state.ratio+(event.key==='ArrowUp'?-.05:.05)});
      refresh();persist();
    });
    panels.set(panel,{bottom,refresh});refresh();
  }
  attach(document.querySelector('.castleBuildPanel'),'left','Steps');
  attach(document.querySelector('.castlePalettePanel'),'right','Categories');
  window.castleSidebarLayout = {...api,
    containerFor: panel => panels.get(panel)?.bottom || panel,
    refresh: () => { for(const panel of panels.values())panel.refresh(); }
  };
})();
