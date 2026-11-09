// Read ambiguous letter forms from ink geometry and neighboring characters.
// This only refines OCR text; it never draws, erases, or replaces a pen stroke.
function inkLoopGeometry(region,pixels){
 if(!region?.box||!pixels?.data)return {round:false,externalTail:false};
 const [x0,y0,x1,y1]=region.box;
 const w=x1-x0+1,h=y1-y0+1;
 if(w<24||h<22||w/h<.61||w/h>1.48)
   return {round:false,externalTail:false};
 const dark=(x,y)=>{
  if(x<0||y<0||x>=pixels.width||y>=pixels.height)return false;
  const k=(y*pixels.width+x)*4;
  return pixels.data[k]+pixels.data[k+1]+pixels.data[k+2]<620;
 };
 let central=0,total=0;
 for(let y=Math.floor(y0+h*.35);y<=Math.floor(y0+h*.65);y++)
 for(let x=Math.floor(x0+w*.35);x<=Math.floor(x0+w*.65);x++){
  central+=Number(dark(x,y));total++;
 }
 // This is a loop or oval, with a mostly unpainted central opening.
 if(total<8||central/total>.43)return {round:false,externalTail:false};
 const rows=[];
 for(let y=Math.ceil(y0);y<=Math.floor(y1);y++){
  let filled=0;
  for(let x=Math.ceil(x0);x<=Math.floor(x1);x++)if(dark(x,y))filled++;
  rows.push(filled);
 }
 const maxInk=Math.max(...rows);
 if(maxInk<6)return {round:false,externalTail:false};
 const floor=rows.findLastIndex(v=>v>=Math.max(5,maxInk*.28));
 const externalTail=(rows.length-1-floor)>Math.max(7,h*.13);
 return {round:true,externalTail};
}
function caseAwareWordReading(regions,predictions,pixels,strokes,letters,dictionary){
 const changed=letters.slice();
 const strongLower=/^[abdefghijknpqrt]$/;
 const eligibleAmbiguous=/^[oOQ0xXyY]$/;
 let start=0;
 for(let finish=0;finish<=regions.length;finish++){
  const boundary=finish===regions.length||
    (finish>start&&(regions[finish].line!==regions[finish-1].line||
                    regions[finish].space));
  if(!boundary)continue;
  const ids=Array.from({length:finish-start},(_,i)=>start+i);
  if(ids.length>=2&&ids.length<=24&&
     ids.every(i=>/^[a-zA-Z0-9×]$/.test(changed[i]||""))){
   const old=ids.map(i=>changed[i]).join("");
   const lowerWord=old.toLowerCase();
   const exists=Boolean(dictionary?.has(lowerWord));
   const anchors=ids.filter(i=>strongLower.test(changed[i]));
   const heights=anchors.map(i=>regions[i].box[3]-regions[i].box[1]);
   const tallest=heights.length?Math.max(...heights):0;
   for(const i of ids){
    const current=changed[i];
    const raw=predictions[i]?.top||[];
    const p=(ch)=>raw.find(o=>o.char===ch)?.confidence||0;
    const h=regions[i].box[3]-regions[i].box[1];
    if(current==="×"&&anchors.length>=1&&
       !ids.some(j=>/^[0-9]$/.test(changed[j]))){
      const hasWrittenX=ids.some(j=>j!==i&&/^[xX]$/.test(changed[j]));
      const asLetter=ids.map(j=>j===i?"x":changed[j]).join("").toLowerCase();
      // A lowercase x and the multiplication glyph are effectively the same
      // two crossed strokes. Use direct neighboring letter evidence, not
      // an unconditional replacement of all multiplication signs.
      if((hasWrittenX||dictionary?.has(asLetter))&&
         p("x")>=Math.max(.025,p("×")*.065)&&
         tallest>=h*1.22){
        changed[i]="x";
      }
      continue;
    }
    if(!eligibleAmbiguous.test(current))continue;
    if((current==="Q"||current==="O"||current==="0")&&
       anchors.length>=2&&
       tallest>h*1.18&&
       (p("o")>=.006||p("O")>=.025||current==="Q")){
      const ring=inkLoopGeometry(regions[i],pixels);
      if(ring.round&&!ring.externalTail&&
         // Capital Q and digit zero should not be rewritten solely because
         // they're adjacent to letters: require an actual compact loop.
         (current==="Q"||p("o")>=.025||p("O")>=.1))
        changed[i]="o";
    }
    // Case folding applies only to same-shaped letters in a real lowercase
    // dictionary word. It is not generic spelling autocorrect.
    if((current==="Y"||current==="X"||current==="O")&&
       i>start&&exists&&anchors.length>=1&&
       !/^[A-Z]{2,}$/.test(old)){
      const little=current.toLowerCase();
      // Descenders can make lowercase y as tall as uppercase Y.
      // For X/O, require near-normal lowercase body height as well.
      if(current==="Y"||(tallest>0&&h<=tallest*1.12))
       changed[i]=little;
    }
   }
  }
  start=finish;
 }
 return changed;
}
