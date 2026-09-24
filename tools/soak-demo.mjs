// Read-only acceptance run. No synthetic heartbeats or status writes.
import {mkdirSync, appendFileSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const seconds = Number(process.argv[2] || 1800);
if (!Number.isFinite(seconds) || seconds < 1) throw Error('Positive duration required');
mkdirSync('tmp/soak', {recursive:true});
const started = Date.now(), stamp = new Date(started).toISOString().replaceAll(':','-');
const output = `tmp/soak/${stamp}`;
let minOnline=100, maxErrors=0, samples=0, failures=0, longestGapMs=0, previousAt=started;
const previousSeen=new Map(), changes=new Map();
do {
  const at=Date.now(); longestGapMs=Math.max(longestGapMs,at-previousAt);previousAt=at;
  let sample;
  try {
    const response=await fetch('http://127.0.0.1:8787/api/fleet?scope=go100&pageSize=100',{signal:AbortSignal.timeout(4000)});
    if(!response.ok) throw Error(`HTTP ${response.status}`);
    const data=await response.json();
    const live=data.items.filter(d=>d.status==='online').length;
    const invalid=data.items.some(d=>d.simulated || d.provider!=='native' || !/^go-agent-(?:0[0-9]{2}|100)$/.test(d.externalId));
    const ages=data.items.map(d=>Date.now()-Date.parse(d.lastSeen));
    if(invalid || data.summary.total!==100 || data.items.length!==100 || live!==data.summary.online || live<90 || data.summary.error>0) failures++;
    minOnline=Math.min(minOnline,live);maxErrors=Math.max(maxErrors,data.summary.error);
    for(const d of data.items){if(previousSeen.has(d.externalId)&&previousSeen.get(d.externalId)!==d.lastSeen)changes.set(d.externalId,(changes.get(d.externalId)||0)+1);previousSeen.set(d.externalId,d.lastSeen);}
    sample={at:new Date(at).toISOString(),...data.summary,maxHeartbeatAgeMs:Math.max(...ages),devices:data.items.map(d=>({id:d.externalId,status:d.status,lastSeen:d.lastSeen}))};
  }catch(error){failures++;sample={at:new Date(at).toISOString(),error:error.message};}
  samples++;appendFileSync(`${output}.jsonl`,JSON.stringify(sample)+'\n');
  const elapsedMs=Date.now()-started;
  const result={started:new Date(started).toISOString(),ended:new Date().toISOString(),elapsedSeconds:elapsedMs/1000,requestedSeconds:seconds,samples,minOnline,maxErrors,failures,longestGapMs,agentsWithAdvancingHeartbeat:changes.size,minimumHeartbeatChanges:changes.size?Math.min(...changes.values()):0,complete:elapsedMs>=seconds*1000,passed:elapsedMs>=seconds*1000&&failures===0&&changes.size===100&&longestGapMs<10000,sampleFile:`${output}.jsonl`};
  writeFileSync('tmp/soak/latest.json',JSON.stringify(result,null,2));
  if(result.complete){writeFileSync(`${output}.summary.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;break;}
  await delay(2000);
} while(true);
