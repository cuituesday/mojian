const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCanvas,loadImage}=require('canvas');
const {themes,defaultSettings}=require('../lib/themes');
const {render}=require('../lib/render');
async function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-layout-review-'));
  const list=['dashboard','month-calendar','calendar','trending','news','weather'];
  const sheet=createCanvas(1240,680),ctx=sheet.getContext('2d');ctx.fillStyle='#eceee8';ctx.fillRect(0,0,sheet.width,sheet.height);
  const feeds={trending:{status:'排版示例',items:Array.from({length:18},(_,i)=>({title:`示例话题 ${i+1} · 今天发生了哪些有趣的事`} ))},news:{status:'排版示例',items:['这是一条用于验证排版的示例新闻，不是真实新闻内容。','城市更新与绿色出行：让日常生活更加便利，也让街区保留自己的特色。','阅读、散步与记录，把时间留给重要的小事。','第四条新闻用于检查自动分页与页码显示。'].map(title=>({title}))}};
  for(let i=0;i<list.length;i++){
    const theme=themes.find(t=>t.id===list[i]),frame=await render(theme,defaultSettings,{},new Date('2026-09-29T04:00:00Z'),{feeds});
    fs.writeFileSync(path.join(directory,`${theme.id}.png`),frame.png);
    const x=10+(i%3)*410,y=10+Math.floor(i/3)*335;ctx.drawImage(await loadImage(frame.png),x,y);ctx.font='14px sans-serif';ctx.fillStyle='#314633';ctx.fillText(theme.name,x,y+320);
  }
  fs.writeFileSync(path.join(directory,'contact-sheet.png'),sheet.toBuffer());console.log(directory);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
