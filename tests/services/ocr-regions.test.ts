import { describe, expect, it, vi } from 'vitest';
import { findMetricRegions, recoverMissingMetrics } from '../../src/services/ocr-regions';
import type { OcrPage } from '../../src/services/ocr-layout';

function page(label='平均 配 速'):OcrPage {
  const word=(text:string,x0:number,y0:number,x1:number,y1:number)=>({text,bbox:{x0,y0,x1,y1}});
  return {blocks:[{paragraphs:[{lines:[
    {bbox:{x0:80,y0:400,x1:680,y1:430},words:[word('平均步频',80,400,210,430),word(label,530,400,680,430)]},
    {bbox:{x0:80,y0:450,x1:850,y1:500},words:[word('167步/分',80,450,240,500),word('5人',530,450,680,500)]},
    {bbox:{x0:80,y0:570,x1:220,y1:600},words:[word('平均心率',80,570,220,600)]},
  ]}]}]};
}
const canvas={width:1000,height:1200} as HTMLCanvasElement;

describe('label-derived missing metric regions',()=>{
  it('finds the value below average pace without including the left column or next row',()=>{
    const regions=findMetricRegions(page(),1000,1200);
    expect(regions).toHaveLength(1);
    expect(regions[0].field).toBe('averagePaceSecondsPerKm');
    const r=regions[0].rectangle;
    expect(r.left).toBeGreaterThan(450);
    expect(r.top).toBeGreaterThanOrEqual(430);
    expect(r.top).toBeLessThan(450);
    expect(r.top+r.height).toBeGreaterThan(500);
    expect(r.top+r.height).toBeLessThan(570);
    expect(r.left+r.width).toBeLessThanOrEqual(1000);
  });
  it('scales with OCR coordinates and supports split label words or a recurring final glyph',()=>{
    const scaled=JSON.parse(JSON.stringify(page('平均 配 束'),(_key,value)=>typeof value==='number'?value*1.7:value));
    const a=findMetricRegions(page(),1000,1200)[0].rectangle;
    const b=findMetricRegions(scaled,1700,2040)[0].rectangle;
    expect(b.left).toBeCloseTo(a.left*1.7,-1);
    expect(b.height).toBeCloseTo(a.height*1.7,-1);
  });
  it('requires explicit average-pace labels and valid dimensions',()=>{
    expect(findMetricRegions(page('配速'),1000,1200)).toEqual([]);
    expect(findMetricRegions({},1000,1200)).toEqual([]);
    expect(findMetricRegions(page(),0,1200)).toEqual([]);
    expect(findMetricRegions(page(),1000,NaN)).toEqual([]);
  });
  it('clamps a crop to the image and declines regions entirely outside it',()=>{
    const regions=findMetricRegions(page(),700,510);
    expect(regions[0].rectangle.top+regions[0].rectangle.height).toBeLessThanOrEqual(510);
    expect(findMetricRegions(page(),500,300)).toEqual([]);
  });
});

describe('targeted OCR recovery',()=>{
  it('recovers a read value, requests only the missing field, and uses temporary parameters',async()=>{
    const worker={recognize:vi.fn().mockResolvedValue({data:{text:'7\'14\'"/ 公 里'}})};
    const result=await recoverMissingMetrics(worker,canvas,page(),{});
    expect(result).toBe('平均配速 7\'14"/公里');
    expect(worker.recognize).toHaveBeenCalledOnce();
    expect(worker.recognize.mock.calls[0][1]).toMatchObject({rectangle:expect.any(Object),tessedit_pageseg_mode:'7',tessedit_char_whitelist:expect.stringContaining('0123456789')});
    expect(await recoverMissingMetrics(worker,canvas,page(),{averagePaceSecondsPerKm:434})).toBe('');
    expect(worker.recognize).toHaveBeenCalledOnce();
  });
  it('retries another line mode for unreadable output, without guessing absent digits',async()=>{
    const worker={recognize:vi.fn().mockResolvedValueOnce({data:{text:'5 人'}}).mockResolvedValueOnce({data:{text:'8:23 /km'}})};
    expect(await recoverMissingMetrics(worker,canvas,page(),{})).toBe('平均配速 8\'23"/公里');
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(worker.recognize.mock.calls[1][1].tessedit_pageseg_mode).toBe('13');
  });
  it.each(['5 人','655 /公里','7:85 /km','7:14 /mi','7:14 /km 8:12 /km','173','-7:14 /km','1:07:14 /km'])('leaves invalid or ambiguous targeted text empty: %s',async text=>{
    const worker={recognize:vi.fn().mockResolvedValue({data:{text}})};
    expect(await recoverMissingMetrics(worker,canvas,page(),{})).toBe('');
  });
  it('does not discard first-pass data when a targeted recognition fails',async()=>{
    const worker={recognize:vi.fn().mockRejectedValue(new Error('region failed'))};
    expect(await recoverMissingMetrics(worker,canvas,page(),{})).toBe('');
  });
  it('does no OCR when there is no usable average-pace label',async()=>{
    const worker={recognize:vi.fn()};
    expect(await recoverMissingMetrics(worker,canvas,page('配速'),{})).toBe('');
    expect(worker.recognize).not.toHaveBeenCalled();
  });
  it('leaves conflicting recovered averages empty instead of choosing the first',async()=>{
    const source=page();
    source.blocks![0].paragraphs![0].lines!.push({bbox:{x0:530,y0:800,x1:680,y1:830},words:[{text:'平均配速',bbox:{x0:530,y0:800,x1:680,y1:830}}]});
    const worker={recognize:vi.fn().mockResolvedValueOnce({data:{text:'7:14 /km'}}).mockResolvedValueOnce({data:{text:'7:15 /km'}})};
    expect(await recoverMissingMetrics(worker,canvas,source,{})).toBe('');
  });
});
