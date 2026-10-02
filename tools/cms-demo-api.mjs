import {createXiboClientFromEnv} from '../integrations/xibo-client.mjs';
export const client=createXiboClientFromEnv();
if(!client) throw Error('CMS credentials missing in .env.local');
export async function api(endpoint,method='GET',fields={}) {
  const url=new URL(`/api/${endpoint}`,client.baseUrl);
  const form=new URLSearchParams();
  for(const [key,value] of Object.entries(fields)) {
    if(Array.isArray(value)) value.forEach(v=>form.append(`${key}[]`,String(v)));
    else if(value!==undefined&&value!==null)form.set(key,String(value));
  }
  if(method==='GET')url.search=form.toString();
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${await client.accessToken()}`,Accept:'application/json',...(method==='GET'?{}:{'Content-Type':'application/x-www-form-urlencoded'})},body:method==='GET'?undefined:form,signal:AbortSignal.timeout(120000)});
  const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{result=raw;}
  if(!response.ok)throw Error(`${method} ${endpoint}: ${response.status} ${raw.slice(0,1000)}`);
  return result;
}
