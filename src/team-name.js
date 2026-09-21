export function teamNameLines(name) {
  const text=String(name||'').trim().replace(/\s+/g,' ');
  if(text.length<=16 || !text.includes(' ')) return [text];
  const words=text.split(' ');
  // Keep a birth year and team colour together on the second line.
  const year=words.findIndex((word,index)=>index>0 && /^20\d{2}(?:[/-]\d{2,4})?$/.test(word));
  if(year>0) return [words.slice(0,year).join(' '),words.slice(year).join(' ')];
  let split=1, difference=Infinity;
  for(let i=1;i<words.length;i++) {
    const delta=Math.abs(words.slice(0,i).join(' ').length-words.slice(i).join(' ').length);
    if(delta<difference){difference=delta;split=i;}
  }
  return [words.slice(0,split).join(' '),words.slice(split).join(' ')];
}
export function renderTeamName(element,name) {
  element.replaceChildren(...teamNameLines(name).map(line=>{
    const span=document.createElement('span');span.className='team-name-line';span.textContent=line;return span;
  }));
  element.title=String(name||'');
}
