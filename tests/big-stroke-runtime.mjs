import fs from "node:fs";
import vm from "node:vm";
import {performance} from "node:perf_hooks";
const path="models/ink-stroke-google-teacher-big-v1.json",reportPath="models/big-stroke-google-teacher-metrics.json";
const report=JSON.parse(fs.readFileSync(reportPath,"utf8"));
if(!report.eligible){console.log("Larger model was rejected by handwriting tests; original stays");process.exit(0)}
const src=fs.readFileSync("src/stroke_worker.js","utf8"),times=[];
for(const file of ["models/ink-stroke-prefix-domain-v2.json",path]){
 const model=JSON.parse(fs.readFileSync(file,"utf8")),msgs=[];
 const context={Float32Array,Math,Array,Number,Error,
   atob:s=>Buffer.from(s,"base64").toString("binary"),
   self:{postMessage:m=>msgs.push(m)}};
 vm.createContext(context);vm.runInContext(src,context);
 context.self.onmessage({data:{cmd:"init",model}});
 if(!msgs.some(m=>m.type==="ready"))throw Error("Worker did not initialize");
 const prefix=[[.22,.15,0]];for(let i=0;i<21;i++)prefix.push([.009,.011,1]);
 const ms=[];
 for(let i=0;i<8;i++){
  const t=performance.now();
  context.self.onmessage({data:{cmd:"generate",serial:100+i,epoch:2,
    seed:4+i,live:true,maxSteps:20,prefix,preferred:"h",
    options:[{char:"h",confidence:.95}]}});
  ms.push(performance.now()-t);
  if(!msgs.some(m=>m.type==="completion"&&m.serial===100+i&&m.neural))
   throw Error("Not a valid neural completion");
 }
 ms.sort((a,b)=>a-b);
 times.push({source:file,median_ms:+ms[4].toFixed(2),max_ms:+ms.at(-1).toFixed(2)});
}
report.runtime={reference:times[0],candidate:times[1]};
report.latency_verified=times[1].median_ms<180&&times[1].median_ms<=times[0].median_ms*1.65;
report.eligible=report.eligible&&report.latency_verified;
if(!report.eligible)fs.unlinkSync(path);
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+"\n");
console.log("Measured browser-worker neural inference",report.runtime,"eligible",report.eligible);
