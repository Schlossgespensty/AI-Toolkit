'use strict';
(function(root){
  const data=typeof module==='object'&&module.exports ? require('./castle-construction-data') : root.castleConstructionData;
  const tileTypes=new Set([25,26,35,46,181,182,183,184,185,186]);
  function evaluate(type,rects,terrain,size=100) {
    type=Number(type);
    const rule=data.rules[type];
    if(!terrain?.buildFlags || (!rule && !tileTypes.has(type)))return null;
    const padding=terrain.padding || 0,edge=size+padding*2,reasons=new Set();
    let min=Infinity,max=-Infinity;
    for(const rect of rects)for(let y=rect.bottom;y<=rect.top;y++)for(let x=rect.left;x<=rect.right;x++) {
      const index=(y+padding)*edge+x+padding;
      const outside=x < -padding || y < -padding || x >= size+padding || y >= size+padding;
      const flags=outside ? 16 : terrain.buildFlags[index];
      const height=Number(terrain.heights?.[index]) || 0;
      min=Math.min(min,height);max=Math.max(max,height);
      if(flags & 48)reasons.add('outside');
      if(flags & (1|1048576|2097152))reasons.add('water');
      if((flags & 128) && !rule?.clearRock)reasons.add('rock');
      if((flags & 536870912) && !rule?.marsh)reasons.add('marsh');
      if((flags & 1073741824) && !rule?.moat)reasons.add('moat');
      if(rule && ((rule.heightLimit>=0 && height>rule.heightLimit) || (rule.heightLimit<0 && height < -rule.heightLimit)))reasons.add('height');
    }
    // These are native height units across the footprint, not a number of tiles.
    if(rule && max-min>rule.maxHeightDifference)reasons.add('slope');
    if(type===105 && max>12)reasons.add('height');
    return reasons.size ? {reasons:[...reasons],min,max,limit:rule?.maxHeightDifference} : null;
  }
  const api={evaluate};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.castleConstruction=api;
})(globalThis);
