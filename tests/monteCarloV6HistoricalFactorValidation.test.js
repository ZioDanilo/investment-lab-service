const {validateHistoricalFactorPremiums}=require('../src/services/monteCarloV6HistoricalFactorValidationService');
const sample=()=>Array.from({length:180},(_,i)=>({
  date:`${2000+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`,
  marketExcess:.007+Math.sin(i*1.7)*.045,
  MOMENTUM:.003+Math.cos(i*.8)*.027,
  VALUE:.001+Math.sin(i*.9)*.025,
  SIZE_SMALL_CAP:.001+Math.cos(i*1.2)*.018
}));
const metadata={source:'Research monthly series',definition:'long_short_excess',benchmark:'global equity excess',currency:'USD',asOf:'2026-10-21'};
test('returns reproducible metrics without altering input',()=>{
 const rows=sample(),before=JSON.stringify(rows);
 const report=validateHistoricalFactorPremiums({...metadata,rows});
 expect(report.factors).toHaveLength(3);
 expect(report.factors[0].rolling10Year.windows).toBe(61);
 expect(report.factors[0].confidence95).toHaveLength(2);
 expect(report.regimes.status).toBe('NOT_VALIDATED');
 expect(JSON.stringify(rows)).toBe(before);
});
test('rejects total-return series misrepresented as premiums',()=>{
 expect(()=>validateHistoricalFactorPremiums({...metadata,definition:'ETF_total_return',rows:sample()})).toThrow(/long_short_excess/);
});
test('rejects missing months',()=>{
 const rows=sample();rows.splice(5,1);
 expect(()=>validateHistoricalFactorPremiums({...metadata,rows})).toThrow(/contiguous/);
});
test('rejects flat market',()=>{
 const rows=sample().map(r=>({...r,marketExcess:.01}));
 expect(()=>validateHistoricalFactorPremiums({...metadata,rows})).toThrow(/zero variance/);
});
