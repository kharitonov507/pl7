const $ = id => document.getElementById(id);
let fleet = [], state, selected, busy = false;
const labels = {native:'Go-плеер',browser:'Browser Player',simulation:'Go Agent · Demo',xibo:'Player Server'};
const statuses = {online:'На связи',offline:'Нет связи',error:'Ошибка'};
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function current(item) {
  const now = Date.now();
  const inside = (!item.startsAt || now >= Date.parse(item.startsAt)) && (!item.endsAt || now < Date.parse(item.endsAt));
  const playlist = state?.playlists.find(p=>p.id===(inside ? item.playlistId : item.fallbackId));
  const entries = playlist?.items || [];
  const duration = entries.reduce((n,e)=>n+e.duration,0);
  let time = duration ? (now/1000 + Number(item.externalId.match(/\d+$/)?.[0] || 0)*3)%duration : 0;
  let entry = entries[0]; for(const e of entries){entry=e;if(time<e.duration)break;time-=e.duration;}
  return {playlist,asset:state?.assets.find(a=>a.id===entry?.assetId)};
}
function render() {
  for(const item of fleet){
    const tile = document.querySelector(`[data-key="${CSS.escape(item.provider+':'+item.externalId)}"]`);
    if(!tile)continue; const {asset} = current(item); const key=asset?.id || '';
    if(tile.dataset.asset!==key){tile.dataset.asset=key;tile.querySelector('.picture').innerHTML=asset?.type.startsWith('image/')?`<img src="${esc(asset.url)}" alt="${esc(asset.name)}">`:`<div class="placeholder">${asset?'▶ '+esc(asset.name):'Нет предпросмотра'}</div>`;}
  }
}
async function refresh(){
  if(busy)return;busy=true;
  try{const [a,b]=await Promise.all([fetch('/api/fleet?demo=100&includeReal=1&pageSize=100'),fetch('/api/state')]);if(!a.ok||!b.ok)throw Error('Сервер недоступен');const data=await a.json();state=await b.json();fleet=data.items;
    $('summary').textContent=`${fleet.length} дисплеев · ${fleet.length} Go-agent endpoints · Player Server`;
    $('wall').innerHTML=fleet.map((d,i)=>`<button class="tile" data-key="${esc(d.provider+':'+d.externalId)}" aria-label="Экран ${i+1}: ${esc(d.name)}"><div class="picture"></div><footer><span>${String(i+1).padStart(3,'0')} · ${esc(d.name)}</span><span class="${esc(d.status)}">●</span></footer><small>${esc(labels[d.provider])} · ${esc(statuses[d.status])}</small></button>`).join('');render();
  }catch(e){$('summary').textContent=e.message;}finally{busy=false;}
}
$('wall').onclick=event=>{const tile=event.target.closest('[data-key]');if(!tile)return;selected=fleet.find(d=>d.provider+':'+d.externalId===tile.dataset.key);const {asset,playlist}=current(selected);$('title').textContent=selected.name;$('detail-info').textContent=`${labels[selected.provider]} · ${selected.externalId} · ${selected.location} · ${statuses[selected.status]}`;
  $('preview').innerHTML=asset ? (asset.type.startsWith('video/')?`<video src="${esc(asset.url)}" controls autoplay muted loop playsinline></video>`:`<img src="${esc(asset.url)}" alt="${esc(asset.name)}">`):'';
  $('detail-playlist').textContent=`Плейлист: ${playlist?.name || 'Смотрите назначение в Player Server'} · версия ${selected.version || 0}`;
  $('delivery').textContent=selected.simulated?'Предпросмотр демо-модели. Настройки сохраняются локально.':selected.provider==='xibo'?'Снимок Player Server. Локальные настройки пока не отправляются в неё.':'Предпросмотр расписания. Команды отправляются локальному плееру; получение зависит от связи.';
  $('commands').hidden=!['native','browser'].includes(selected.provider);$('command-result').textContent='';$('configure').href=`/fleet.html?provider=${encodeURIComponent(selected.provider)}&device=${encodeURIComponent(selected.externalId)}`;$('details').showModal();};
$('close').onclick=()=>$('details').close();$('details').addEventListener('close',()=>$('preview').replaceChildren());
$('commands').onclick=async event=>{const button=event.target.closest('[data-command]');if(!button)return;button.disabled=true;try{const r=await fetch(`/api/devices/${encodeURIComponent(selected.externalId)}/command`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.command})});if(!r.ok)throw Error((await r.json()).error);$('command-result').textContent='Команда поставлена в очередь плеера.';}catch(e){$('command-result').textContent=e.message;}finally{button.disabled=false;}};
$('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
await refresh();setInterval(render,1000);setInterval(refresh,10000);
