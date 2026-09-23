// Thin renderer: no IndexedDB, no upstream CMS access, no media download queue.
const stage=document.getElementById('stage');
const error=document.getElementById('error');
let state,currentSession='',element,preparing=false,generation=0,socket;
let wasPaused=false,position=0,posting=false;
if(new URL(location.href).searchParams.get('kiosk')==='1')document.body.classList.add('kiosk');
async function report(kind,detail=''){
 const body={kind,sessionId:currentSession,playedMs:position,detail,visible:document.visibilityState==='visible'};
 const response=await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw new Error(`Go bridge ${response.status}`);
}
function showError(text){error.textContent=text;error.hidden=!text;}
async function command(action){const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),action})});if(!response.ok)showError(await response.text());}
document.getElementById('pause').onclick=()=>command(state?.paused?'resume':'pause').catch(e=>showError(e.message));
document.getElementById('next').onclick=()=>command('next').catch(e=>showError(e.message));
async function prepare(playback){
 const mine=++generation;preparing=true;currentSession=playback.sessionId;position=0;
 if(element){element.onended=null;element.onerror=null;element.pause?.();}const media=document.createElement(playback.asset.type.startsWith('video/')?'video':'img');element=media;
 if(media.tagName==='VIDEO'){media.muted=true;media.playsInline=true;media.preload='auto';}else media.alt=playback.asset.name;
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Таймаут подготовки материала')),12000);
   media[media.tagName==='VIDEO'?'onloadeddata':'onload']=()=>{clearTimeout(timer);resolve();};
   media.onerror=()=>{clearTimeout(timer);reject(new Error('Ошибка чтения или декодирования материала'));};
   media.src=`/media/${playback.asset.sha256}`;
  });
  if(mine!==generation)return;stage.replaceChildren(media);
  media.onended=()=>{position=media.currentTime*1000;report('ended').catch(e=>showError(e.message));};
  media.onerror=()=>report('failed','Ошибка декодирования').catch(e=>showError(e.message));
  if(media.tagName==='VIDEO' && !state.paused && !document.hidden)await media.play();
  if(mine!==generation)return;
  if(!state.paused && !document.hidden)await report('ready');showError('');
 }catch(e){if(mine===generation){showError(e.message);await report('failed',e.message).catch(()=>{});}}
 finally{if(mine===generation)preparing=false;}
}
async function update(next){
 state=next;document.getElementById('device').textContent=`${state.name||state.deviceId} · Go-agent`;
 document.getElementById('connection').textContent=`${state.online?'CMS online':'Offline · диск'} · ${state.queue} в очереди`;
 document.getElementById('details').textContent=`${state.playlistName||'Нет расписания'} · ${state.cacheCount} файлов · SQLite WAL`;
 document.getElementById('pause').textContent=state.paused?'Продолжить':'Пауза';
 if(state.error)showError(state.error);
 if(parent!==window){const playback=state.current;parent.postMessage({type:'dooh-state',state:{deviceId:state.deviceId,online:state.online,paused:state.paused,assetId:playback?.asset.id,assetName:playback?.asset.name,playlistName:state.playlistName,queue:state.queue,cacheCount:state.cacheCount,error:state.error,elapsed:playback?.playedMs||0,duration:playback?.durationMs||0}},'*');}
 if(state.current && state.current.sessionId!==currentSession){await prepare(state.current);wasPaused=state.paused;}
 if(!preparing && element && state.paused!==wasPaused){
  wasPaused=state.paused;
  if(element.tagName==='VIDEO'){if(state.paused || document.hidden)element.pause();else await element.play();}
  if(!state.paused && !document.hidden && !state.current?.started)await report('ready');
 }
}
function connect(){
 socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
 socket.onmessage=message=>{update(JSON.parse(message.data)).catch(e=>showError(e.message));};
 socket.onclose=()=>{showError('Нет связи с Go-агентом. Повторное подключение…');setTimeout(connect,2000);};
}
document.addEventListener('visibilitychange',async()=>{
 try { await report('alive'); if(element?.tagName==='VIDEO'){if(document.hidden)element.pause();else if(!state?.paused && !preparing)await element.play();} if(!document.hidden && !state?.paused && state?.current && !preparing && !state.current.started)await report('ready'); }
 catch(e){showError(e.message);}
});
setInterval(async()=>{
 if(posting || socket?.readyState!==WebSocket.OPEN)return;posting=true;
 try{await report('alive');if(element?.tagName==='VIDEO' && !preparing){position=element.currentTime*1000;await report('progress');}}
 catch(e){showError(e.message);}finally{posting=false;}
},500);
connect();
