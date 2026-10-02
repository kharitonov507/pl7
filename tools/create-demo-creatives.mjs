// Original vector artwork and copy, rendered locally. No third-party footage.
import {createCanvas,GlobalFonts} from '../reference-xibo/node_modules/@napi-rs/canvas/index.js';
import {mkdirSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
const out='data/demo-creatives';mkdirSync(out,{recursive:true});
const binaryDir='.tools/media/imageio_ffmpeg/binaries';
const ffmpeg=process.env.FFMPEG || path.resolve(binaryDir,readdirSync(binaryDir).find(n=>n.endsWith('.exe')));
GlobalFonts.registerFromPath('C:/Windows/Fonts/arial.ttf','Demo Sans');
GlobalFonts.registerFromPath('C:/Windows/Fonts/arialbd.ttf','Demo Bold');
export const creatives=[
 {id:'coffee',name:'Кофейня у парка — утренний ритуал',advertiser:'КОФЕЙНЯ У ПАРКА',headline:['Ваше утро.','Ваш кофе.'],sub:'Свежая выпечка и любимый вкус',cta:'Начните день с приятного',duration:12,bg:'#241b25',accent:'#efb78a',icon:'cup'},
 {id:'auto',name:'Городской автосалон — новый маршрут',advertiser:'ГОРОДСКОЙ АВТОСАЛОН',headline:['Впереди —','новый маршрут.'],sub:'Найдите автомобиль для своего ритма',cta:'Запишитесь на тест-драйв',duration:15,bg:'#102639',accent:'#5ad6df',icon:'car'},
 {id:'market',name:'Свежий рынок — сезон рядом',advertiser:'СВЕЖИЙ РЫНОК',headline:['Больше свежего.','Каждый день.'],sub:'Овощи, фрукты и идеи для ужина',cta:'Загляните по дороге домой',duration:12,bg:'#183426',accent:'#c4e48c',icon:'fruit'},
 {id:'fitness',name:'Студия движения — время для себя',advertiser:'СТУДИЯ ДВИЖЕНИЯ',headline:['Ваш темп.','Ваша энергия.'],sub:'Занятия для уверенного старта',cta:'Попробуйте новое направление',duration:15,bg:'#302248',accent:'#d2adff',icon:'rings'},
 {id:'home',name:'Дом и свет — уют в деталях',advertiser:'ДОМ И СВЕТ',headline:['Место, куда','хочется вернуться.'],sub:'Свет и детали для любимого дома',cta:'Создайте свой уют',duration:18,bg:'#30271f',accent:'#f0d2a3',icon:'lamp'},
 {id:'city',name:'Городские выходные — встречаемся в парке',advertiser:'ГОРОДСКИЕ ВЫХОДНЫЕ',headline:['Ближе друг','к другу.'],sub:'Прогулки, музыка и маленькие открытия',cta:'Встречаемся в парке',duration:18,bg:'#13354c',accent:'#ffc789',icon:'sun'}
];
function draw(c,ctx,t){
 ctx.fillStyle=c.bg;ctx.fillRect(0,0,1280,720);
 const gradient=ctx.createRadialGradient(1040,300,0,1040,300,550);gradient.addColorStop(0,c.accent+'44');gradient.addColorStop(1,c.bg);ctx.fillStyle=gradient;ctx.fillRect(700,0,580,720);
 ctx.save();ctx.translate(1020+Math.sin(t*.65)*15,330+Math.cos(t*.8)*10);ctx.strokeStyle=c.accent;ctx.fillStyle=c.accent;ctx.lineWidth=9;ctx.lineCap='round';
 ctx.globalAlpha=.14;ctx.beginPath();ctx.arc(0,0,180+Math.sin(t)*6,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 if(c.icon==='cup'){ctx.beginPath();ctx.roundRect(-90,-40,145,125,18);ctx.stroke();ctx.beginPath();ctx.arc(63,0,38,-Math.PI/2,Math.PI/2);ctx.stroke();for(let x=-60;x<45;x+=40){ctx.beginPath();ctx.moveTo(x,-75);ctx.bezierCurveTo(x+Math.sin(t)*15,-100,x-15,-125,x,-145);ctx.stroke();}ctx.fillRect(-110,115,205,7);}
 else if(c.icon==='car'){ctx.beginPath();ctx.roundRect(-140,-10,280,75,20);ctx.stroke();ctx.beginPath();ctx.moveTo(-85,-10);ctx.lineTo(-55,-70);ctx.lineTo(60,-70);ctx.lineTo(105,-10);ctx.stroke();for(const x of [-85,85]){ctx.beginPath();ctx.arc(x,70,25,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=.4;ctx.fillRect(-160+((t*60)%50),125,300,4);}
 else if(c.icon==='fruit'){for(const [x,y,r] of [[-65,25,65],[65,35,70],[0,-70,55]]){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();}ctx.beginPath();ctx.ellipse(25,-140,35,12,-.6,0,Math.PI*2);ctx.fill();}
 else if(c.icon==='rings'){for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(0,0,65+i*35,t*.2+i,t*.2+i+Math.PI*1.55);ctx.stroke();}}
 else if(c.icon==='lamp'){ctx.beginPath();ctx.moveTo(-65,-120);ctx.lineTo(65,-120);ctx.lineTo(120,30);ctx.lineTo(-120,30);ctx.closePath();ctx.stroke();ctx.fillRect(-4,35,8,110);ctx.fillRect(-65,150,130,8);}
 else {ctx.beginPath();ctx.arc(0,0,70,0,Math.PI*2);ctx.stroke();for(let i=0;i<12;i++){const a=i*Math.PI/6+t*.06;ctx.beginPath();ctx.moveTo(Math.cos(a)*105,Math.sin(a)*105);ctx.lineTo(Math.cos(a)*138,Math.sin(a)*138);ctx.stroke();}}
 ctx.restore();
 ctx.fillStyle=c.accent;ctx.font='22px "Demo Bold"';ctx.fillText(c.advertiser,74,85);
 ctx.globalAlpha=Math.min(1,t*2+.15);ctx.fillStyle='#fffaf4';ctx.font='64px "Demo Bold"';c.headline.forEach((line,i)=>ctx.fillText(line,68,280+i*85));ctx.globalAlpha=1;
 ctx.font='27px "Demo Sans"';ctx.fillStyle='#e6e2dd';ctx.fillText(c.sub,74,456);
 ctx.fillStyle=c.accent;ctx.beginPath();ctx.roundRect(74,520,590,65,12);ctx.fill();ctx.fillStyle=c.bg;ctx.font='26px "Demo Bold"';ctx.fillText(c.cta,98,562);
 ctx.fillStyle=c.accent+'55';ctx.fillRect(74,640,1120,3);ctx.fillStyle=c.accent;ctx.fillRect(74,640,1120*t/c.duration,3);
 ctx.fillStyle='#c3c6cd';ctx.font='15px "Demo Sans"';ctx.fillText('ГОРОДСКАЯ МЕДИАСЕТЬ  /  РЕКЛАМНАЯ КОЛЛЕКЦИЯ',74,682);
}
for(const c of creatives){
 const file=`${out}/${c.id}.mp4`;if(existsSync(file)){console.log('Exists',file);continue;}
 const canvas=createCanvas(1280,720),ctx=canvas.getContext('2d');
 const encoder=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-r','20','-i','pipe:0','-an','-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',file],{windowsHide:true,stdio:['pipe','ignore','pipe']});
 let error='';encoder.stderr.on('data',b=>error+=b);const done=once(encoder,'close');
 for(let f=0;f<c.duration*20;f++){draw(c,ctx,f/20);if(f===60)writeFileSync(`${out}/${c.id}.png`,canvas.toBuffer('image/png'));if(!encoder.stdin.write(canvas.toBuffer('image/png')))await once(encoder.stdin,'drain');}
 encoder.stdin.end();const [code]=await done;if(code)throw Error(error);console.log('Created',file,c.duration+'s');
}
writeFileSync(`${out}/manifest.json`,JSON.stringify(creatives,null,2));
