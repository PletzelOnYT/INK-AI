import fs from "node:fs";
import vm from "node:vm";
import {performance} from "node:perf_hooks";
const path="models/ink-stroke-prefix-domain-v3.json",metricsPath="models/stroke-prefix-domain-v3-metrics.json";
const metrics=JSON.parse(fs.readFileSync(metricsPath,"utf8"));
if(!metrics.eligible){console.log("V3 GRU rejected on unseen writers; no runtime change");process.exit(0)}
const worker=fs.readFileSync("src/stroke_worker.js","utf8");
function run(file){
 const model=JSON.parse(fs.readFileSync(file,"utf8")),msgs=[];
 const context={Float32Array,Math,Number,Array,Error,
   atob:s=>Buffer.from(s,"base64").toString("binary"),
   self:{postMessage:m=>msgs.push(m)}};
 vm.createContext(context);
 vm.runInContext(worker,context);
 context.self.onmessage({data:{cmd:"init",model}});
 if(!msgs.some(x=>x.type==="ready"))throw Error("GRU cannot initialize "+file);
 const prefix=[[.22,.22,0]];
 for(let i=0;i<24;i++)prefix.push([.009,.008,1]);
 const elapsed=[];
 for(let seed=0;seed<6;seed++){
  const start=performance.now();
  context.self.onmessage({data:{cmd:"generate",serial:600+seed,epoch:8,
    seed,live:true,maxSteps:24,prefix,preferred:"h",
    options:[{char:"h",confidence:1}]}});
  elapsed.push(performance.now()-start);
  if(!msgs.some(x=>x.type==="completion"&&x.serial===600+seed&&x.neural))
   throw Error("Neural completion failed "+file);
 }
 elapsed.sort((a,b)=>a-b);
 return {model:file,median_ms:+elapsed[3].toFixed(2),max_ms:+elapsed.at(-1).toFixed(2)};
}
const original=run("models/ink-stroke-prefix-domain-v2.json"),proposed=run(path);
metrics.runtime={original,proposed};
metrics.runtime_accepted=proposed.median_ms<=original.median_ms*1.40 && proposed.median_ms<140;
metrics.deployable=metrics.eligible&&metrics.runtime_accepted;
fs.writeFileSync(metricsPath,JSON.stringify(metrics,null,2)+"\n");
if(!metrics.runtime_accepted){
 fs.unlinkSync(path);
 console.log("V3 rejected by actual JavaScript browser-worker latency:",metrics.runtime);
}else{
 console.log("PASS: trained V3 GRU improved writer-heldout quality and preserved worker latency",metrics.runtime);
}
