export interface OcrBox { x0:number; y0:number; x1:number; y1:number }
interface Symbol { text:string; bbox:OcrBox }
interface Word { text:string; bbox:OcrBox; symbols?:Symbol[] }
interface Line { text?:string; bbox:OcrBox; words?:Word[] }
export interface OcrPage { blocks?:{paragraphs?:{lines?:Line[]}[]}[] | null }
type Label = { kind:'temperature'|'humidity'|'aqi'; bbox:OcrBox };
const center = (b:OcrBox) => (b.x0+b.x1)/2;
const height = (b:OcrBox) => Math.max(1,b.y1-b.y0);
const union = (items:OcrBox[]):OcrBox => ({x0:Math.min(...items.map(b=>b.x0)),y0:Math.min(...items.map(b=>b.y0)),x1:Math.max(...items.map(b=>b.x1)),y1:Math.max(...items.map(b=>b.y1))});
const compact = (text:string) => text.replace(/\s/g,'');
function labelsFor(line:Line):Label[] {
  const words=line.words??[];
  const segments=words.map(w=>({text:compact(w.text),bbox:w.bbox}));
  const text=segments.map(s=>s.text).join('');
  const specs:[Label['kind'],RegExp][]=[['temperature',/气温|天.?气|Temperature/i],['humidity',/湿度|Humidity/i],['aqi',/空气质量(?:指数)?|AQI/i]];
  return specs.flatMap(([kind,pattern])=>{
    const match=pattern.exec(text);if(!match)return [];
    let offset=0;const boxes:OcrBox[]=[];
    for(const segment of segments){
      const end=offset+segment.text.length;
      if(end>match.index&&offset<match.index+match[0].length)boxes.push(segment.bbox);
      offset=end;
    }
    return boxes.length?[{kind,bbox:union(boxes)}]:[];
  });
}
function cleanSymbols(word:Word):Symbol[] {
  const symbols=word.symbols??[];
  return symbols.filter((symbol,index)=>{
    if(!/^\d$/.test(symbol.text)||!index)return true;
    const previous=symbols[index-1];
    if(/[\d.\-]/.test(previous.text))return true;
    const overlap=Math.max(0,Math.min(previous.bbox.x1,symbol.bbox.x1)-Math.max(previous.bbox.x0,symbol.bbox.x0));
    return overlap/Math.max(1,symbol.bbox.x1-symbol.bbox.x0)<0.2;
  });
}
function numericGroups(word:Word):{text:string;bbox:OcrBox}[] {
  if(!word.symbols?.length)return [...word.text.matchAll(/-?\d+(?:\.\d+)?/g)].map(m=>({text:m[0],bbox:word.bbox}));
  const symbols=cleanSymbols(word);const groups:Symbol[][]=[];
  for(const symbol of symbols){
    if(!/^[\d.\-]$/.test(symbol.text))continue;
    const current=groups.at(-1);const previous=current?.at(-1);
    if(!previous||symbol.bbox.x0-previous.bbox.x1>Math.min(height(previous.bbox),height(symbol.bbox))*0.65)groups.push([symbol]);
    else current!.push(symbol);
  }
  return groups.filter(g=>/^-?\d+(?:\.\d+)?$/.test(g.map(s=>s.text).join(''))).map(g=>({text:g.map(s=>s.text).join(''),bbox:union(g.map(s=>s.bbox))}));
}
function valueFor(label:Label,words:Word[]):string|null {
  const options=words.flatMap(word=>{
    if(label.kind==='humidity'&&!word.text.includes('%'))return [];
    if(label.kind==='temperature'&&!/[°℃℉]/.test(word.text))return [];
    if(label.kind==='aqi'&&/[°℃℉%]/.test(word.text))return [];
    return numericGroups(word).map(group=>({...group,word}));
  }).filter(group=>Math.abs(center(group.bbox)-center(label.bbox))<=Math.max(label.bbox.x1-label.bbox.x0,height(label.bbox)*3));
  options.sort((a,b)=>Math.abs(center(a.bbox)-center(label.bbox))-Math.abs(center(b.bbox)-center(label.bbox)));
  const candidate=options[0];if(!candidate)return null;
  const runnerUp=options[1];
  if(runnerUp&&Math.abs(Math.abs(center(candidate.bbox)-center(label.bbox))-Math.abs(center(runnerUp.bbox)-center(label.bbox)))<=height(label.bbox)*0.15)return null;
  const number=Number(candidate.text);
  if(label.kind==='humidity')return number>=0&&number<=100?`湿度 ${candidate.text}%`:null;
  if(label.kind==='aqi')return Number.isInteger(number)&&number>=0&&number<=1000?`空气质量指数 ${candidate.text}`:null;
  if(number < -130 || number > 160)return null;
  const unit=candidate.word.text.match(/°\s*[CF]|℃|℉|°/i)?.[0].replace(/\s/g,'');
  return unit?`气温 ${candidate.text}${unit}`:null;
}
/** Only uses an explicit weather-label cluster; no screenshot coordinates or preset values. */
export function supplementalWorkoutText(page:OcrPage):string {
  const raw=(page.blocks??[]).flatMap(block=>(block.paragraphs??[]).flatMap(paragraph=>paragraph.lines??[]));
  const lines=raw.reduce<Line[]>((rows,line)=>{
    const index=rows.findIndex(row=>Math.abs(row.bbox.y0-line.bbox.y0)<Math.min(height(row.bbox),height(line.bbox))*0.6);
    if(index<0)return [...rows,line];
    return rows.map((row,i)=>i!==index?row:{bbox:union([row.bbox,line.bbox]),words:[...(row.words??[]),...(line.words??[])].sort((a,b)=>a.bbox.x0-b.bbox.x0)});
  },[]);
  const labeled=lines.flatMap(line=>labelsFor(line).map(label=>({label,line})));
  const humidity=labeled.find(item=>item.label.kind==='humidity');if(!humidity)return '';
  const rowHeight=height(humidity.line.bbox);
  const rowLabels=labeled.filter(item=>Math.abs(item.line.bbox.y0-humidity.line.bbox.y0)<=rowHeight*0.8);
  if(!rowLabels.some(item=>item.label.kind==='aqi'))return '';
  const preceding=lines.filter(line=>{
    const text=(line.words??[]).map(word=>word.text).join(' ');
    if(/\b\d{1,2}\s*[:：]\s*\d{2}\b/.test(text)||!/[°℃℉%]/.test(text))return false;
    return line.bbox.y0<humidity.line.bbox.y0&&humidity.line.bbox.y0-line.bbox.y1<rowHeight*4&&line.bbox.y1<=humidity.line.bbox.y0+rowHeight*0.3;
  });
  if(!preceding.length)return '';
  const latest=Math.max(...preceding.map(line=>line.bbox.y1));
  const words=preceding.filter(line=>latest-line.bbox.y1<rowHeight).flatMap(line=>line.words??[]);
  const fields=rowLabels.map(({label})=>valueFor(label,words)).filter((value):value is string=>value!==null);
  return fields.length?['天气',...fields].join('\n'):'';
}
