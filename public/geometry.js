(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MojianGeometry=factory();})(globalThis,function(){
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function resize(start,handle,dx,dy,keepRatio=false){
    let width=start.width,height=start.height;
    if(handle.includes('e'))width+=dx;if(handle.includes('w'))width-=dx;
    if(handle.includes('s'))height+=dy;if(handle.includes('n'))height-=dy;
    if(keepRatio){const ratio=start.width/start.height;
      if(!/[ns]/.test(handle)||(/[ew]/.test(handle)&&Math.abs(width/start.width-1)>=Math.abs(height/start.height-1)))height=width/ratio;
      else width=height*ratio;
      const factor=clamp(width/start.width,Math.max(1/start.width,1/start.height),Math.min(3200/start.width,3200/start.height));
      width=start.width*factor;height=start.height*factor;
    }
    width=clamp(Math.round(width),1,3200);height=clamp(Math.round(height),1,3200);
    const x=handle.includes('w')?start.x+start.width-width:start.x;
    const y=handle.includes('n')?start.y+start.height-height:start.y;
    return {x:clamp(x,-1600,3200),y:clamp(y,-1600,3200),width,height};
  }
  const flipHandle=h=>h.replace(/[nsew]/g,c=>({n:'s',s:'n',e:'w',w:'e'}[c]));
  return {resize,flipHandle,clamp};
});
