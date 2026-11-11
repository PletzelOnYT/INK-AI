"use strict";
/* Reconstruct readable lines/paragraphs from on-screen OCR geometry.
 * No language-model rewriting: preserve the words and punctuation actually
 * detected on the page, with carefully inferred spaces and soft line wraps.
 */
(()=>{
 const vertical=box=>Math.max(1,(box?.y1||0)-(box?.y0||0));
 const midpoint=box=>((box?.y0||0)+(box?.y1||0))/2;
 const normalize=s=>String(s||"").replace(/\s+/g," ").trim();
 function formatWords(words){
  const ordered=(words||[]).filter(w=>w&&typeof w.text==="string")
   .slice().sort((a,b)=>(a.box?.x0??0)-(b.box?.x0??0));
  let out="",previous=null;
  for(const item of ordered){
   const token=normalize(item.text);
   if(!token)continue;
   if(!previous){out=token;previous=item;continue}
   const noSpaceBefore=/^[,.;:!?%‰°)\]}]+/.test(token)||
      /^['’](?:s|t|re|ve|ll|d|m)$/i.test(token);
   const noSpaceAfter=/[(\[{“‘$€£#]$/.test(out)||
      /(?:['’]|\/)$/.test(out);
   const attachDash=/^[-–—]$/.test(token)||/[-–—]$/.test(out);
   // Keep a single space between separate words; punctuation must not
   // acquire a gap just because Tesseract boxed it separately.
   out+=(noSpaceBefore||noSpaceAfter||attachDash?"":" ")+token;
   previous=item;
  }
  return out.trim();
 }
 function lineText(line){
  return formatWords(line?.words)||normalize(line?.text);
 }
 const isSentenceEnd=text=>/[.!?]["'’”)]?$/.test(text);
 function sortLines(lines){
  return [...(lines||[])].filter(l=>l?.box)
   .sort((a,b)=>{
    const ay=midpoint(a.box),by=midpoint(b.box);
    const heights=(vertical(a.box)+vertical(b.box))/2;
    if(Math.abs(ay-by)>Math.max(7,heights*.46))return ay-by;
    return (a.box.x0||0)-(b.box.x0||0);
   });
 }
 function formatDocument(lines){
  const sorted=sortLines(lines);
  if(!sorted.length)return "";
  // Detect columns by vertical overlap and large nonoverlapping x ranges.
  // When a long page has two distinct columns, finish one column before
  // starting the next instead of alternating lines across the columns.
  const positions=sorted.map(line=>({
    line,left:line.box.x0,right:line.box.x1,top:line.box.y0,
    bottom:line.box.y1,height:vertical(line.box),text:lineText(line)
  })).filter(x=>x.text);
  if(!positions.length)return "";
  let ordered=positions;
  if(positions.length>=4){
   const lefts=positions.map(x=>x.left).sort((a,b)=>a-b);
   let widest=0,division=null;
   for(let i=1;i<lefts.length;i++){
    const gap=lefts[i]-lefts[i-1];
    if(gap>widest){widest=gap;division=(lefts[i]+lefts[i-1])/2}
   }
   if(division!==null&&widest>Math.max(85,
       positions.reduce((n,x)=>n+x.height,0)/positions.length*4)){
    const left=positions.filter(x=>x.left<division);
    const right=positions.filter(x=>x.left>=division);
    const leftRight=Math.max(...left.map(x=>x.right));
    const rightLeft=Math.min(...right.map(x=>x.left));
    if(left.length>=2&&right.length>=2&&leftRight+18<rightLeft)
      ordered=[...left,...right];
   }
  }
  const maxRight=Math.max(...positions.map(x=>x.right));
  const chunks=[];
  let previous=null;
  for(const current of ordered){
   const value=current.text;
   if(!previous){chunks.push(value);previous=current;continue}
   const lineGap=current.top-previous.bottom;
   const h=Math.max(1,(current.height+previous.height)/2);
   const leftAligned=Math.abs(current.left-previous.left)<Math.max(25,h*1.35);
   const close=lineGap<Math.max(10,h*.92)&&lineGap>=-h*.6;
   const sameParagraph=current.line.blockIndex!==undefined&&
     current.line.blockIndex===previous.line.blockIndex&&
     current.line.paragraphIndex!==undefined&&
     current.line.paragraphIndex===previous.line.paragraphIndex;
   const hyphenated=/[A-Za-z]{2,}-$/.test(previous.text)&&/^[a-z]/.test(value);
   const nearRight=maxRight-previous.right<Math.max(22,h*1.7);
   const longText=previous.text.length>=34&&value.length>=9;
   const lowerContinuation=/^[a-z]/.test(value)&&
     !isSentenceEnd(previous.text)&&previous.text.length>=12;
   const join=close&&leftAligned&&(
     hyphenated||sameParagraph||lowerContinuation||
     (longText&&nearRight&&!/[:;]$/.test(previous.text))
   );
   if(join){
    if(hyphenated){
     chunks[chunks.length-1]=chunks[chunks.length-1].replace(/-$/,"")+value;
    }else chunks[chunks.length-1]+=" "+value;
   }else{
    const bigGap=lineGap>h*1.4;
    const newParagraph=bigGap||
      (previous.line.paragraphIndex!==undefined&&
       current.line.paragraphIndex!==undefined&&
       previous.line.blockIndex===current.line.blockIndex&&
       previous.line.paragraphIndex!==current.line.paragraphIndex);
    chunks.push((newParagraph?"\n\n":"\n")+value);
   }
   previous=current;
  }
  return chunks.join("").slice(0,6000);
 }
 window.InkCameraLayout={formatWords,lineText,sortLines,formatDocument};
})();
