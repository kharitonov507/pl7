// Starts three native agents without replacing the original browser devices.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const binary=path.join(directory,'bin',process.platform==='win32'?'dooh-agent.exe':'dooh-agent');
if(!existsSync(binary)){console.error('Build agent first: agent/build-agent.cmd or go build -o bin/dooh-agent .');process.exit(1);}
const children=[];let shuttingDown=false;
function start(command,args,cwd){const child=spawn(command,args,{cwd,stdio:'inherit',windowsHide:true});children.push(child);child.on('error',error=>{console.error(error.message);shutdown();});return child;}
function shutdown(){if(shuttingDown)return;shuttingDown=true;for(const child of children)child.kill('SIGTERM');}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
async function cmsReady(){try{return(await fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}}
try {
if(!await cmsReady()){
 start(process.execPath,['server.mjs'],path.dirname(directory));
 for(let i=0;i<20 && !await cmsReady();i++)await new Promise(resolve=>setTimeout(resolve,250));
 if(!await cmsReady()){console.error('CMS did not start');shutdown();process.exitCode=1;}
}
if(!process.exitCode && !shuttingDown){
 const playlists=['motion-loop','morning','cityloop'];
 for(let i=1;i<=3;i++){
  const deviceId=`go-screen-0${i}`;const port=8790+i;
  const response=await fetch('http://127.0.0.1:8787/api/devices/register',{method:'POST',headers:{'Content-Type':'application/json',...(process.env.DOOH_CMS_TOKEN?{Authorization:`Bearer ${process.env.DOOH_CMS_TOKEN}`}:{})},body:JSON.stringify({deviceId,name:`Go-плеер 0${i}`,playlistId:playlists[i-1],rendererUrl:`http://127.0.0.1:${port}/`})});
  if(!response.ok){console.error(`Register failed: ${response.status}. Restart the CMS after updating server.mjs.`);shutdown();process.exitCode=1;break;}
  const child=start(binary,['-config','config.example.json','-device',deviceId,'-listen',`127.0.0.1:${port}`,'-data',path.join(directory,'data',deviceId),'-mqtt-topic',`dooh/lab/${deviceId}`],directory);
  child.on('exit',code=>{if(!shuttingDown){console.error(`${deviceId} exited (${code}); stopping demo agents`);shutdown();process.exitCode=1;}});
 }
 if(!process.exitCode)console.log('\nGo demo: http://127.0.0.1:8787/?agents=go\nOpen only one dashboard with these device IDs. Ctrl+C stops agents started here.\nOriginal browser demo remains at http://127.0.0.1:8787/');
}
} catch(error) { console.error(`Native demo startup failed: ${error.message}`); shutdown(); process.exitCode=1; }
