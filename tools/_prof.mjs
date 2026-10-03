import { readPNG } from './png.mjs';
const name = process.argv[2];
const { w, h, data } = readPNG(`assets/v2/char/src/${name}.png`);
const al = (x,y)=>data[(y*w+x)*4+3];
const runs=(y)=>{const o=[];let s=-1;for(let x=0;x<=w;x++){const on=x<w&&al(x,y)>=40;if(on&&s<0)s=x;if(!on&&s>=0){if(x-s>=4)o.push([s,x-1]);s=-1;}}return o;};
for(let y=Number(process.argv[3]);y<=Number(process.argv[4]);y+=Number(process.argv[5]||20)){
  const r=runs(y); console.log(String(y).padStart(4), '塊'+r.length, r.map(([a,b])=>`${a}-${b}(${b-a+1})`).join(' '));
}
