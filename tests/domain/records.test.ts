import { describe,it,expect } from 'vitest';
import { emptyRecord } from '../../src/domain/model';
import { SAMPLE_RECORD } from '../../src/domain/sample';
import { validateRecord,withChallenge,duplicateMatch,getStats } from '../../src/domain/records';

describe('validation and challenge', () => {
  it('accepts supplied sample',()=>expect(validateRecord(SAMPLE_RECORD)).toEqual([]));
  it.each([1799,1800,3600])('counts at most once for %i seconds',durationSeconds=>expect(withChallenge({...SAMPLE_RECORD,durationSeconds}).challenge.completedCount).toBe(durationSeconds>=1800?1:0));
  it('requires a real date and explicit duration',()=>expect(validateRecord(emptyRecord()).length).toBeGreaterThan(0));
  it.each([{date:'2026-02-30'},{date:'2026-13-01'},{date:'2026-1-2'},{startTime:'25:10'},{endTime:'12:70'},{durationSeconds:Infinity},{distanceKm:-1},{averageHeartRateBpm:900},{humidityPercent:101},{effortLevel:11},{timezone:'not/a/zone'},{splits:[{index:1,durationSeconds:-1,paceSecondsPerKm:400,heartRateBpm:160}]},{splits:[{index:0,durationSeconds:1,paceSecondsPerKm:400,heartRateBpm:160}]}])('rejects invalid record %j',changes=>expect(validateRecord({...SAMPLE_RECORD,...changes}).length).toBeGreaterThan(0));
  it('does not mutate inputs',()=>{ const input=Object.freeze({...SAMPLE_RECORD,durationSeconds:0}); expect(withChallenge(input).challenge.completed).toBe(false);expect(input.challenge.completed).toBe(true); });
  it('rejects repeated split indices and fractional split durations',()=>{
    expect(validateRecord({...SAMPLE_RECORD,splits:[SAMPLE_RECORD.splits[0],SAMPLE_RECORD.splits[0]]})).toContain('分段编号不能重复');
    expect(validateRecord({...SAMPLE_RECORD,splits:[{...SAMPLE_RECORD.splits[0],durationSeconds:339.5}]})).toContain('分段时间必须为整数秒');
  });
});

describe('duplicate decisions and totals',()=>{
  it('detects repeat of same activity',()=>expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,id:'other'})).toBe('exact'));
  it('allows a second run on same day',()=>expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,startTime:'08:00'})).toBe('none'));
  it('requires review when evidence is incomplete',()=>expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,startTime:null})).toBe('possible'));
  it('does not match different dates',()=>expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,date:'2026-11-03'})).toBe('none'));
  it('does not classify empty records as duplicates',()=>expect(duplicateMatch(emptyRecord(),emptyRecord())).toBe('none'));
  it('does not match distinct activity types',()=>expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,activityType:'indoor_running'})).toBe('none'));
  it('does not match date alone',()=>expect(duplicateMatch({...emptyRecord(),date:'2026-11-02'},SAMPLE_RECORD)).toBe('none'));
  it('handles partial evidence and duration based matching conservatively',()=>{
    expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,startTime:null,distanceKm:null})).toBe('possible');
    expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,startTime:null,durationSeconds:null})).toBe('possible');
    expect(duplicateMatch(SAMPLE_RECORD,{...SAMPLE_RECORD,durationSeconds:1600,distanceKm:3})).toBe('possible');
  });
  it('counts records with unknown times conservatively',()=>expect(getStats([SAMPLE_RECORD,{...emptyRecord(),durationSeconds:100,distanceKm:1}])).toEqual({completedCount:1,distanceKm:5.36,durationSeconds:1912}));
});
