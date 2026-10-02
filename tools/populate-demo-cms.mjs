import {api,client} from './cms-demo-api.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const creatives=JSON.parse(readFileSync('data/demo-creatives/manifest.json','utf8'));
mkdirSync('tmp/stage2',{recursive:true});
const result={media:[],playlists:[],events:[]};
const previous=existsSync('tmp/stage2/content-created.json')?JSON.parse(readFileSync('tmp/stage2/content-created.json','utf8')):{};
const save=()=>writeFileSync('tmp/stage2/content-created.json',JSON.stringify(result,null,2));
for(const c of creatives){
 let media=(await api('library','GET',{length:100})).find(m=>m.name===c.name);
 if(!media){await client.uploadMedia({buffer:readFileSync(`data/demo-creatives/${c.id}.mp4`),name:c.name+'.mp4',type:'video/mp4'});media=(await api('library','GET',{length:100})).find(m=>m.name===c.name+'.mp4'||m.name===c.name);}
 if(!media)throw Error(`Upload not found ${c.id}`);
 await api(`library/${media.mediaId}`,'PUT',{name:c.name,duration:c.duration,enableStat:'On'});
 result.media.push({...c,mediaId:media.mediaId});save();console.log('Media',media.mediaId,c.name);
}
const definitions=[
 {key:'showcase',name:'Городская коллекция',ids:['coffee','auto','market','fitness','home','city']},
 {key:'morning',name:'Доброе утро',ids:['coffee','market','coffee']},
 {key:'active',name:'В движении',ids:['auto','fitness','city']},
 {key:'evening',name:'После работы',ids:['home','city','market']}
];
for(const p of definitions){
 let playlist=(await api('playlist','GET',{length:100})).find(x=>x.name===p.name||x.playlistId===previous.playlists?.find(old=>old.key===p.key)?.playlistId);
 if(playlist&&playlist.name!==p.name)await api(`playlist/${playlist.playlistId}`,'PUT',{name:p.name,isDynamic:0,enableStat:'On'});
 if(!playlist){playlist=await api('playlist','POST',{name:p.name,isDynamic:0,enableStat:'On'});await api(`playlist/library/assign/${playlist.playlistId}`,'POST',{media:p.ids.map(id=>result.media.find(m=>m.id===id).mediaId)});}
 result.playlists.push({...p,playlistId:playlist.playlistId,duration:p.ids.reduce((n,id)=>n+creatives.find(c=>c.id===id).duration,0)});save();console.log('Playlist',playlist.playlistId,p.name);
}
const display=(await api('display')).find(d=>d.display==='DOOH Reference 01');
if(!display)throw Error('Reference display missing');
const definitionsEvents=[
 {key:'showcase',name:'Основной эфир',from:'2026-09-24 00:00:00',to:'2026-10-01 00:00:00',priority:1},
 {key:'morning',name:'Утро четверга',from:'2026-09-24 07:00:00',to:'2026-09-24 10:00:00',priority:2},
 {key:'active',name:'День четверга',from:'2026-09-24 12:00:00',to:'2026-09-24 15:00:00',priority:2},
 {key:'evening',name:'Вечер четверга',from:'2026-09-24 17:00:00',to:'2026-09-24 21:00:00',priority:2},
 {key:'morning',name:'Утро пятницы',from:'2026-09-25 07:00:00',to:'2026-09-25 10:00:00',priority:2},
 {key:'evening',name:'Суббота в городе',from:'2026-09-26 10:00:00',to:'2026-09-26 18:00:00',priority:3}
];
for(const e of definitionsEvents){
 let event=(await api('schedule','GET',{length:100})).find(x=>x.name===e.name);
 const playlist=result.playlists.find(p=>p.key===e.key);
 if(!event)event=await api('schedule','POST',{eventTypeId:8,name:e.name,playlistId:playlist.playlistId,displayGroupIds:[display.displayGroupId],fromDt:e.from,toDt:e.to,isPriority:e.priority,displayOrder:1,dayPartId:1,resolutionId:2});
 event=(await api('schedule','GET',{length:100})).find(x=>x.name===e.name);
 if(!event)throw Error(`Schedule not found: ${e.name}`);
 result.events.push({...e,eventId:event.eventId,campaignId:event.campaignId,playlistId:playlist.playlistId});save();console.log('Event',event.eventId,e.name);
}
console.log('Content ready:',result.media.length,'videos,',result.playlists.length,'playlists,',result.events.length,'events');
