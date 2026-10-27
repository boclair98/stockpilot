// First-tier infrastructure benchmark, NOT user/order capacity. No external APIs.
import http from 'k6/http';
import {check,fail} from 'k6';

const origin=__ENV.BASE_URL||'http://api:8000';
if(!['http://api:8000','http://127.0.0.1:8288','http://localhost:8288'].includes(origin)) fail('Only the isolated readiness fixture origin is allowed');
export const options={
  scenarios:{readiness:{executor:'ramping-arrival-rate',startRate:0,timeUnit:'1s',preAllocatedVUs:30,maxVUs:200,stages:[{duration:'15s',target:25},{duration:'15s',target:25},{duration:'15s',target:50},{duration:'15s',target:50},{duration:'15s',target:100},{duration:'15s',target:100},{duration:'15s',target:200},{duration:'15s',target:200},{duration:'15s',target:400},{duration:'15s',target:400}]}},
  thresholds:{http_req_failed:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'15s'}],http_req_duration:[{threshold:'p(95)<500',abortOnFail:true,delayAbortEval:'15s'}],checks:['rate>0.99'],dropped_iterations:[{threshold:'count==0',abortOnFail:true,delayAbortEval:'15s'}]},
};
export function setup(){
  const r=http.get(`${origin}/__loadtest__/manifest`,{timeout:'5s'});
  let manifest;try{manifest=r.json();}catch{fail('Isolated fixture handshake failed');}
  if(r.status!==200||manifest.contract!=='stockpilot-postgres-readiness-v1'||manifest.isolated!==true||manifest.database!=='stockpilot_load'||manifest.upstream!=='disabled') fail('Refusing non-isolated target');
}
export default function(){
  const r=http.get(`${origin}/api/health/ready`,{timeout:'5s',tags:{name:'postgres_readiness'}});
  check(r,{'ready + DB + Redis':r=>{if(r.status!==200)return false;try{const b=r.json();return b.status==='ready'&&b.components.database==='ok'&&b.components.sharedCache==='ok';}catch{return false;}}});
}
