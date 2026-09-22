import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const size=256, raw=Buffer.alloc((size*4+1)*size);
function pixel(x,y,r,g,b,a=255){const i=y*(size*4+1)+1+x*4;raw[i]=r;raw[i+1]=g;raw[i+2]=b;raw[i+3]=a;}
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const dx=Math.max(40-x,0,x-215),dy=Math.max(40-y,0,y-215);
  const inside=dx*dx+dy*dy<40*40;
  pixel(x,y,38,106,80,inside?255:0);
  if(inside&&x>=53&&x<=203&&y>=76&&y<=107)pixel(x,y,235,243,216);
  if(inside&&x>=65&&x<=191&&y>=115&&y<=190)pixel(x,y,225,236,204);
  if(inside&&x>=106&&x<=150&&y>=130&&y<=141)pixel(x,y,38,106,80);
}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buf){let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),8+data.length);return out;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);
mkdirSync('src-tauri/icons',{recursive:true});writeFileSync('src-tauri/icons/icon.png',png);writeFileSync('src-tauri/icons/icon.ico',Buffer.concat([head,png]));
