import { readPNG } from './png.mjs';
const { w, h, data } = readPNG('assets/v2/char/src/slipper.png');
const at=(x,y)=>{const i=(y*w+x)*4;return `${data[i]},${data[i+1]},${data[i+2]} a${data[i+3]}`;};
console.log('corner', at(2,2), '| edge', at(w-3, Math.floor(h/2)));
console.log('halo',   at(1180, 560), at(1100, 480), at(200, 400));
console.log('slipper',at(600, 750), at(300, 850));
const hist=new Array(9).fill(0);
for(let p=0;p<w*h;p++) hist[Math.min(8,data[p*4+3]>>5)]++;
console.log('alpha hist(32刻み)', hist.join(' '));
