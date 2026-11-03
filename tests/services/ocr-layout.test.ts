import { describe, expect, it } from 'vitest';
import { supplementalWorkoutText, type OcrPage } from '../../src/services/ocr-layout';
const box = (x0:number,y0:number,x1:number,y1:number) => ({x0,y0,x1,y1});
const word = (text:string,x0:number,x1:number,y0=100,y1=130) => ({text,bbox:box(x0,y0,x1,y1)});
const symbol = (text:string,x0:number,x1:number) => ({text,bbox:box(x0,100,x1,130)});
function weather(humidity='72%', aqi='48'):OcrPage {
  const humidSymbols = humidity==='Z572%' ? [symbol('Z',190,222),symbol('5',207,229),symbol('7',234,252),symbol('2',257,275),symbol('%',280,302)] : undefined;
  return {blocks:[{paragraphs:[{lines:[
    {text:'weather values',bbox:box(100,100,470,130),words:[word('¢18°',100,155),{...word(humidity,190,302),symbols:humidSymbols},word(aqi,400,445)]},
    {text:'天气 湿度 空气质量',bbox:box(90,150,480,180),words:[word('天',90,110,150,180),word('气',112,140,150,180),word('湿度',190,240,150,180),word('空气',390,430,150,180),word('质量',432,480,150,180)]},
  ]}]}]};
}
describe('weather text from OCR geometry',()=>{
  it('uses weather labels and preceding value row instead of status bar and graph numbers',()=>{
    const page=weather();
    page.blocks![0].paragraphs![0].lines!.unshift({text:'battery',bbox:box(0,0,500,30),words:[word('99%',200,250,0,30),word('173',400,445,0,30)]});
    expect(supplementalWorkoutText(page)).toBe('天气\n气温 18°\n湿度 72%\n空气质量指数 48');
  });
  it('removes an icon-overlapping numeric duplicate only with symbol evidence',()=>{
    expect(supplementalWorkoutText(weather('Z572%'))).toContain('湿度 72%');
    expect(supplementalWorkoutText(weather('Z572%')).includes('572')).toBe(false);
  });
  it('does not trim unsupported out-of-range humidity into a plausible value',()=>{
    expect(supplementalWorkoutText(weather('572%'))).not.toContain('湿度');
    expect(supplementalWorkoutText(weather('Z572%')).includes('湿度 72%')).toBe(true);
  });
  it('separates a distant icon digit from the air quality value using symbol positions',()=>{
    const page=weather();
    const value=page.blocks![0].paragraphs![0].lines![0].words![2];
    value.text='348'; value.bbox=box(370,100,445,130);
    Object.assign(value,{symbols:[symbol('3',370,380),symbol('4',408,423),symbol('8',428,443)]});
    expect(supplementalWorkoutText(page)).toContain('空气质量指数 48');
  });
  it('works after scaling coordinates and with labels in separate OCR lines',()=>{
    const page=weather('81%','106');
    const lines=page.blocks![0].paragraphs![0].lines!;
    const label=lines.pop()!;
    lines.push(...label.words!.map(w=>({text:w.text,bbox:w.bbox,words:[w]})));
    const scaled=JSON.parse(JSON.stringify(page,(_key,value)=>typeof value==='number'?value*2.5:value));
    expect(supplementalWorkoutText(scaled)).toBe('天气\n气温 18°\n湿度 81%\n空气质量指数 106');
  });
  it('returns nothing without explicit nearby humidity and air-quality weather labels',()=>{
    expect(supplementalWorkoutText({})).toBe('');
    const page=weather();page.blocks![0].paragraphs![0].lines!.pop();
    expect(supplementalWorkoutText(page)).toBe('');
    const far=weather();const l=far.blocks![0].paragraphs![0].lines![1];l.bbox=box(90,900,480,930);l.words!.forEach(w=>{w.bbox={...w.bbox,y0:900,y1:930};});
    expect(supplementalWorkoutText(far)).toBe('');
  });
  it('preserves explicit temperature units and does not infer Celsius from a bare degree',()=>{
    const page=weather();page.blocks![0].paragraphs![0].lines![0].words![0].text='-4°F';
    expect(supplementalWorkoutText(page)).toContain('气温 -4°F');
    expect(supplementalWorkoutText(weather())).not.toContain('°C');
  });
});

it('leaves equally plausible weather values empty instead of selecting the first', () => {
  const page = weather();
  const words = page.blocks![0].paragraphs![0].lines![0].words!;
  words[2] = word('48',400,420);
  words.push(word('99',450,470));
  expect(supplementalWorkoutText(page)).not.toContain('空气质量指数');
});

it('never uses a nearby status bar when the actual weather values are missing', () => {
  const page = weather();
  const line = page.blocks![0].paragraphs![0].lines![0];
  line.text = '21:36 4G 90%';
  line.words = [word('21:36',100,155),word('90%',190,302),word('4G',400,445)];
  expect(supplementalWorkoutText(page)).toBe('');
});
