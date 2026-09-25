'use strict';
(() => {
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);
  const container=document.getElementById('characterStorage');
  let latest=null,signature='',icons={};
  const labelKeys={Hop:'details:hops',Apples:'details:fruit',LeatherArmors:'character:leather_armor',IronArmors:'character:iron_armor'};
  const iconKeys={Apples:'fruit',Hop:'hop'};
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  const metric=(label,value,negative=false)=>{const row=node('div',undefined,'metricRow');row.append(node('span',label),node('strong',String(value),negative?'populationNegative':''));return row;};
  const signed=v=>v>0?'+'+v:String(v);
  function remember(details,key){
    try{const saved=localStorage.getItem('character-card:'+key);if(saved!==null)details.open=saved==='open';}catch{}
    details.addEventListener('toggle',()=>{try{localStorage.setItem('character-card:'+key,details.open?'open':'closed');}catch{}});
  }
  document.querySelectorAll('[data-character-card]').forEach(el=>remember(el,el.dataset.characterCard));
  const sections={};
  for(const [key,title] of [['stockpile','52'],['granary','80'],['armory','81']]){
    const section=node('details',undefined,'characterSubsection');section.open=true;
    const heading=node('summary'),label=node('span',tr('items:'+title)),value=node('strong');label.dataset.i18n='items:'+title;heading.append(label,value);
    const body=node('div');section.append(heading,body);container.append(section);remember(section,key+'-capacity');
    sections[key]={value,body};
  }
  function render(){
    if(!latest)return;
    const result=window.characterPlanning.calculate(...latest);
    for(const [key,view] of Object.entries(sections)){
      const info=result[key],unit=key==='granary'?'details:food':'details:space';
      view.value.textContent=tr(info.shortfall?'details:shortfall':'details:free',{count:info.shortfall||info.free});
      view.value.classList.toggle('populationNegative',info.shortfall>0);
      view.body.replaceChildren(metric(tr("character:capacity"),tr(unit,{count:info.total})),metric(tr("character:needed_at_limits"),tr(unit,{count:info.used})));
      const table=node('table',undefined,'characterStorageTable');
      const head=node('tr');for(const label of [tr('details:resource'),tr('details:maximum'),key==='granary'?'':tr('details:spaces')])head.append(node('th',label));
      const thead=node('thead');thead.append(head);table.append(thead);
      const tbody=node('tbody');
      for(const item of info.rows){
        const row=node('tr'),name=node('td'),label=tr(labelKeys[item.resource]||'options:'+item.resource);
        const src=icons[iconKeys[item.resource]||item.resource.toLowerCase()];
        if(src){const img=node('img');img.src=src;img.alt='';img.width=22;img.height=22;name.append(img);}
        name.append(document.createTextNode(label));
        row.title=item.stack?tr('details:per_space',{count:item.stack,source:item.field?tr('fields:'+item.field,{defaultValue:item.field}):[item.produced?tr("character:production"):'',item.bought?tr("character:recruitment_purchase"):''].filter(Boolean).join(' + ')}):tr("character:maxfood_variance");
        row.append(name,node('td',String(item.amount)),node('td',item.slots===undefined?'':String(item.slots)));tbody.append(row);
      }
      table.append(tbody);view.body.append(table);
      if(!info.rows.length)view.body.append(node('p',tr(key==='armory'?'details:none_produced_or_bought':'details:none_produced'),'cardNote'));
      view.body.append(node('p',tr('details:'+({stockpile:'stockpiles',granary:'granaries',armory:'armories'}[key]),{count:info.buildings}),'cardNote'));
    }
    const fear=result.fear;
    document.getElementById('characterFearLevel').textContent=signed(fear.level);
    document.getElementById('characterFearDetails').replaceChildren(
      metric(tr("character:positive_negative"),fear.positive+' / '+fear.negative),
      metric(tr("character:net_buildings"),signed(fear.net)),
      metric(tr("character:population_groups_of_16"),fear.population+' / '+fear.groups));
    window.toolkitI18n.applyTextDirection(container);
    window.toolkitI18n.applyTextDirection(document.getElementById('characterFearDetails'));
  }
  window.characterHelperPanels={update(a,summary,population){
    const next=[a,summary?.counts||{},population],key=JSON.stringify(next);
    if(key===signature)return;signature=key;latest=next;render();
  }};
  window.electronAPI.readResourceIcons?.().then(value=>{icons=value||{};render();}).catch(()=>{});
  window.toolkitI18n?.onChange(render);
})();
