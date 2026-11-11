import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../src/camera_document_layout.js",import.meta.url),"utf8");
const window={};
vm.runInNewContext(source,{window});
const L=window.InkCameraLayout;
const word=(text,x,y,w=50)=>({text,box:{x0:x,y0:y,x1:x+w,y1:y+20}});
const line=(text,y,x=30,right=500,metadata={})=>({
 text,box:{x0:x,y0:y,x1:right,y1:y+20},
 words:[word(text,x,y,right-x)],...metadata
});
assert.equal(
 L.formatWords([word("Hello",10,10),word(",",80,10,8),
  word("world",95,10),word("!",160,10,8)]),"Hello, world!");
assert.equal(
 L.formatWords([word("The",10,10),word("price",80,10),
  word("is",160,10),word("$",190,10,8),word("25",204,10)]),
 "The price is $25");
assert.equal(L.formatWords([word("NY",10,10),word("THREADS",65,10)]),
 "NY THREADS");
assert.equal(L.formatDocument([
 line("Torrey Pines High School",30,30,285),
 line("3710 Del Mar Heights Rd",59,30,265),
 line("San Diego, CA 92130",88,30,245)
]),"Torrey Pines High School\n3710 Del Mar Heights Rd\nSan Diego, CA 92130",
 "An address must not turn into a long, unstructured sentence");
const paragraph=L.formatDocument([
 line("This is the first part of a paragraph that",20,40,600),
 line("continues on the next physical printed line",50,40,570),
 line("and finishes with punctuation.",80,40,425)
]);
assert.equal(paragraph,
 "This is the first part of a paragraph that continues on the next physical printed line and finishes with punctuation.",
 "Sentence line wraps must not force a newline in the middle of a sentence");
assert.equal(L.formatDocument([
 line("The reading is comprehen-",20,40,470),
 line("sive and easy to follow.",49,40,380)
]),"The reading is comprehensive and easy to follow.",
 "Hyphenation at line wraps should reconstruct one word");
const metadata={blockIndex:0,paragraphIndex:0};
assert.equal(L.formatDocument([
 line("A short",20,40,160,metadata),
 line("wrapped sentence.",49,40,235,metadata)
]),"A short wrapped sentence.",
 "OCR paragraph metadata should preserve genuine short wraps");
assert.equal(L.formatDocument([
 line("First paragraph.",20,40,250),
 line("Second paragraph.",115,40,300)
]),"First paragraph.\n\nSecond paragraph.",
 "Large vertical separation must produce a paragraph break");
const columns=L.formatDocument([
 line("Left one.",20,20,280),
 line("Right one.",20,620,890),
 line("Left two.",56,20,280),
 line("Right two.",56,620,890)
]);
assert.equal(columns,"Left one.\nLeft two.\nRight one.\nRight two.",
 "Two columns should be read by column, not zig-zag row order");
console.log("PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses");
