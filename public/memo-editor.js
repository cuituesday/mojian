(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MojianMemo=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function parse(value){
    if(!value)return [];
    return String(value).replace(/\r\n?/g,'\n').split('\n').map(line=>{
      const match=line.match(/^([ \t]*)([□☐☑]) ?(.*)$/);
      return match?{text:match[1]+match[3],todo:true,done:match[2]==='☑'}:{text:line,todo:false,done:false};
    });
  }
  function serialize(items){return items.map(item=>(item.todo?(item.done?'☑ ':'□ '):'')+item.text).join('\n');}
  function mount(container,field,onChange){
    let items=parse(field.value);
    const list=document.createElement('div');list.className='memo-items';
    const toolbar=document.createElement('div');toolbar.className='memo-toolbar';
    container.replaceChildren(toolbar,list);
    function button(label,action){const b=document.createElement('button');b.type='button';b.className='small';b.textContent=label;b.addEventListener('click',action);return b;}
    function sync(){field.value=serialize(items);onChange();}
    function focus(index){list.children[index]?.querySelector('textarea')?.focus();}
    function add(todo){items.push({text:'',todo,done:false});sync();render();focus(items.length-1);}
    toolbar.append(button('＋ 添加待办',()=>add(true)),button('＋ 添加文字',()=>add(false)));
    function render(){
      list.replaceChildren();
      items.forEach((item,index)=>{
        const row=document.createElement('div');row.className='memo-item';row.classList.toggle('completed',item.done);
        if(item.todo){
          const check=document.createElement('input');check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label',`第 ${index+1} 条事项已完成`);
          check.addEventListener('change',()=>{item.done=check.checked;row.classList.toggle('completed',item.done);sync();});row.append(check);
        }else row.append(button('添加方框',()=>{item.todo=true;sync();render();focus(index);}));
        const input=document.createElement('textarea');input.rows=1;input.value=item.text;input.placeholder='输入事项内容';input.setAttribute('aria-label',`第 ${index+1} 条备忘录`);
        const resize=()=>{input.style.height='auto';input.style.height=`${Math.max(40,input.scrollHeight)}px`;};
        input.addEventListener('input',()=>{
          const lines=input.value.replace(/\r\n?/g,'\n').split('\n');
          if(lines.length>1){items.splice(index,1,...lines.map(text=>({...item,text})));sync();render();focus(index+lines.length-1);}
          else {item.text=input.value;sync();resize();}
        });
        input.addEventListener('keydown',event=>{
          if(event.key!=='Enter'||event.isComposing)return;
          event.preventDefault();const start=input.selectionStart,end=input.selectionEnd;
          const next={text:item.text.slice(end),todo:item.todo,done:false};item.text=item.text.slice(0,start);
          items.splice(index+1,0,next);sync();render();focus(index+1);
        });
        row.append(input);
        if(item.todo)row.append(button('移除方框',()=>{item.todo=false;item.done=false;sync();render();focus(index);}));
        const remove=button('×',()=>{items.splice(index,1);sync();render();focus(Math.min(index,items.length-1));});remove.setAttribute('aria-label',`移除第 ${index+1} 条事项`);row.append(remove);
        list.append(row);resize();
      });
      if(!items.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='还没有事项，点击「添加待办」开始记录。';list.append(empty);}
    }
    render();
  }
  return {parse,serialize,mount};
});
