import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PuzzleScene } from './game/Scene';
import { formatDateInput, parseDateInput, PIECES } from './game/puzzle';
import { decodeStore, GameSession, STORAGE_KEY, type Stamp, type Store } from './game/session';
import { WoodAudio } from './game/audio';
import { seasonFor, type Season } from './game/theme';

function Plant({season}:{season:Season}){
  return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M30 56Q26 29 36 7"/>{season.id==='winter'?<path d="M35 12L21 27M35 12L47 27M32 23L16 38M32 23L50 38M30 36L12 49M30 36L51 49"/>:<><path d="M32 25C56 24 50 5 35 17M30 38C7 35 11 18 30 29M30 51C53 46 50 29 31 41"/>{season.id==='autumn'&&<path d="M36 9l8 8m-10 0l-7-7M33 23l10 4"/>}</>}</svg>;
}
function StampMark({kind,season,day,large=false}:{kind:Stamp;season:Season;day?:number;large?:boolean}){
  return <span className={'stamp '+kind+(large?' large':'')} style={{'--stamp-color':season.color} as CSSProperties}>{day!==undefined?<b>{day}</b>:<Plant season={season}/>}<small>{kind==='independent'?'独立拼成':kind==='assisted'?'灵感相助':'参考留痕'}</small></span>;
}
function load():{store:Store;error:boolean}{try{return {store:decodeStore(localStorage.getItem(STORAGE_KEY)),error:false};}catch{return {store:decodeStore(null),error:true};}}

export default function App(){
  const [loaded]=useState(load);
  const [session]=useState(()=>new GameSession(new Date(),loaded.store));
  const [,render]=useState(0);const mount=useRef<HTMLDivElement>(null),scene=useRef<PuzzleScene|null>(null),audio=useRef<WoodAudio|null>(null);
  const [notice,setNotice]=useState(session.solved?'这一天的木作已恢复，慢慢欣赏。':'挑一块木头，开始今天的拼图。');
  const [storageError,setStorageError]=useState(loaded.error);const [sceneError,setSceneError]=useState(false);
  const [selected,setSelected]=useState<number|null>(null);const [help,setHelp]=useState(false),[calendar,setCalendar]=useState(false);
  const [calendarMonth,setCalendarMonth]=useState(()=>new Date(session.date.getFullYear(),session.date.getMonth(),1));
  const [win,setWin]=useState<Stamp|null>(null);
  const theme=seasonFor(session.date),key=formatDateInput(session.date),solved=session.solved;

  function persist(){
    session.save();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(session.store));setStorageError(false);}catch{setStorageError(true);}
    render(n=>n+1);
  }
  function unlock(){audio.current?.unlock();}
  function finish(message?:string){
    scene.current?.sync(session.date,session.state.pieces);
    if(session.solved&&!session.state.celebrated){
      const stamp=session.collect();if(stamp){setWin(stamp);setNotice(stamp==='independent'?'今天，恰到好处。独立完成印章已收入日历。':'拼好了。灵感相助印章已收入日历。');scene.current?.celebrate();audio.current?.play('win');}
    }
    if(message)setNotice(message);persist();
  }
  useEffect(()=>{
    const sound=new WoodAudio();audio.current=sound;sound.muted=session.store.muted;
    const unlockSound=()=>sound.unlock();document.addEventListener('pointerdown',unlockSound,true);document.addEventListener('keydown',unlockSound,true);
    let view:PuzzleScene|undefined;
    try{if(mount.current){view=new PuzzleScene(mount.current,session.date,session.state.pieces,{
      commit:pieces=>{if(session.commit(pieces))finish();},hover:setSelected,message:setNotice,sound:kind=>sound.play(kind),
    });scene.current=view;}}catch(error){console.error(error);setSceneError(true);}
    const saveOnHide=()=>{if(document.hidden){view?.cancelDrag();session.save();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(session.store));}catch{setStorageError(true);}}};
    document.addEventListener('visibilitychange',saveOnHide);
    return()=>{view?.dispose();scene.current=null;sound.dispose();audio.current=null;document.removeEventListener('pointerdown',unlockSound,true);document.removeEventListener('keydown',unlockSound,true);document.removeEventListener('visibilitychange',saveOnHide);};
  },[session]);
  function undo(){unlock();scene.current?.cancelDrag();if(session.undo()){setWin(null);finish('退回上一步，换个思路再试。');}}
  function redo(){unlock();scene.current?.cancelDrag();if(session.redo())finish('已恢复这一步。');}
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||!(e.ctrlKey||e.metaKey))return;
      if(e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}
    };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  });
  function changeDate(value:string){
    if(!value)return;const date=parseDateInput(value);if(!Number.isFinite(date.getTime())||formatDateInput(date)!==value)return;
    unlock();scene.current?.cancelDrag();session.changeDate(date);setWin(null);setSelected(null);setCalendarMonth(new Date(date.getFullYear(),date.getMonth(),1));
    finish(session.solved?'这一天的木作已恢复，慢慢欣赏。':session.state.past.length?'已找回这一天的拼图，接着慢慢拼。':'新的日期，新的可能。');
  }
  function restart(){unlock();scene.current?.cancelDrag();session.restart();setWin(null);setSelected(null);finish('重新开始。每一块，都有新的可能。');}
  function hint(){
    unlock();scene.current?.cancelDrag();const result=session.hint();
    finish(result==='placed'?'一点灵感：已替你放好一块。':result==='limit'?'这一步需要再想一会儿。试着移开一块后再获取灵感。':result==='unsolvable'?'目前的布局接不上完整答案。撤销或移开几块再试。':'已经拼好了，欣赏一下今天的木作吧。');
    if(result==='placed')audio.current?.play('drop');
  }
  function reveal(){unlock();scene.current?.cancelDrag();session.reveal();setWin(null);finish('这是今天的一种拼法。参考答案不会授予通关印章，重新挑战可以独立尝试。');}
  function toggleSound(){session.store.muted=!session.store.muted;if(audio.current)audio.current.muted=session.store.muted;unlock();persist();}
  const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth(),days=new Date(year,month+1,0).getDate(),offset=(new Date(year,month,1).getDay()+6)%7;
  const monthPrefix=year+'-'+String(month+1).padStart(2,'0')+'-';
  const collected=Object.entries(session.store.stamps).filter(([date,stamp])=>date.startsWith(monthPrefix)&&stamp!=='viewed').length;
  const longDate=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(session.date);
  return <main className={'page season-'+theme.id} style={{'--season':theme.color,'--season-pale':theme.pale} as CSSProperties}>
    <header className="header"><a className="brand" href="#top"><span className="brand-mark">木</span><span>木日</span><i/><small>THE ART OF EVERY DAY</small></a><div className="header-right"><span className="live-dot"/>每日一局 · 慢慢拼就好<button className="help-button" onClick={()=>setHelp(!help)} aria-label="操作说明" aria-expanded={help}>?</button><button className="sound-button" onClick={toggleSound} aria-label={session.store.muted?'开启音效':'关闭音效'} aria-pressed={!session.store.muted}>{session.store.muted?'音效 关':'♪ 音效 开'}</button></div></header>
    <section className="intro" id="top"><div className="intro-copy"><div className="eyebrow"><span>ONE DAY, ONE PUZZLE</span><i/><span>{theme.name}</span></div><h1>把今天，拼出来。</h1><p>{theme.note}</p></div><div className="date-card"><div className="date-stamp"><Plant season={theme}/></div><div className="date-copy"><small>{key===formatDateInput(new Date())?'今日木作':'时光里的这一天'}</small><strong>{longDate}</strong></div><label className="date-picker" title="选择挑战日期"><span>▦</span><input type="date" value={key} onChange={e=>changeDate(e.target.value)} aria-label="选择挑战日期"/></label></div></section>
    {help&&<aside className="help-panel"><strong>只留下两格，就是今天。</strong><p>用 8 块木块覆盖底盘，留下月份和日期。左键拖动，滚轮旋转，右键翻转；也可以按 R / Shift+R 旋转、F 翻转、Esc 取消。绿色预览可落下，红色预览需要调整。Ctrl / ⌘ + Z 撤销，Shift + Ctrl / ⌘ + Z 重做。</p><p>独立拼成获得实心印章，灵感相助获得线框印章；直接看答案只留参考记录。局面自动保存在当前浏览器。</p><button onClick={()=>setHelp(false)}>开始慢慢拼</button></aside>}
    <section className={'game-panel'+(solved?' complete':'')} aria-label="日历拼图游戏">
      <div className="panel-head"><div className="board-heading"><span className="board-glyph">▦</span><div><strong>四季木作 · {theme.mark}</strong><small>胡桃木底盘 / 八片时光</small></div></div><div className="goal-chips"><span>只留下</span><b>{session.date.getMonth()+1}<small>月</small></b><b>{session.date.getDate()}<small>日</small></b></div><div className="progress-area"><div className="progress-top"><span>入盘</span><strong>{session.placements.length}<small> / 8</small></strong></div><div className="progress-line"><i style={{width:session.placements.length/8*100+'%'}}/></div></div><div className="history-buttons"><button onClick={undo} disabled={!session.state.past.length} aria-label="撤销" title="Ctrl / ⌘ + Z">↶</button><button onClick={redo} disabled={!session.state.future.length} aria-label="重做" title="Shift + Ctrl / ⌘ + Z">↷</button></div><button className="reset-button" aria-label="重新挑战" onClick={restart}><span>↺</span>重新挑战</button></div>
      <div className="scene-shell"><div className="scene-wrap" ref={mount}/><div className="table-caption"><span className="caption-line"/>{selected!==null?PIECES[selected].name+' · 天然木纹':theme.name+'  /  M U R I'}</div><div className="table-corner"><Plant season={theme}/></div>{sceneError&&<div className="scene-error">3D 画面未能启动。请开启浏览器硬件加速后刷新。</div>}
        {win&&<div className="win-overlay"><section className="win-card" aria-label="通关纪念"><span className="eyebrow">A DAY WELL PIECED</span><StampMark kind={win} season={theme} large/><h2>今天，恰到好处。</h2><p>{session.date.getMonth()+1} 月 {session.date.getDate()} 日的时光，已收入木作日历。</p><span className="win-kind">{win==='independent'?'独立完成 · 实心印章':'灵感相助 · 线框印章'}</span><div><button onClick={()=>setWin(null)}>欣赏木作</button><button onClick={()=>{setWin(null);setCalendar(true);}}>翻开印章日历 ↗</button></div></section></div>}
      </div>
      <div className="panel-foot"><div className={'game-message'+(solved&&!session.state.viewed?' win':'')} role="status"><span className="message-glyph">{solved&&!session.state.viewed?'✓':'✳'}</span><span>{notice}</span></div><div className="controls"><span>左键拖动</span><b>·</b><span>滚轮旋转</span><b>·</b><span>右键翻转</span></div></div>
    </section>
    <section className="lower-row"><div className="daily-note"><div className="note-mark"><Plant season={theme}/></div><div><strong>一日，一拼。一枚时光的印记。</strong><p>{storageError?'当前浏览器无法保存，关闭页面后进度可能丢失。':'自动记住你的每一步，下次回来接着拼。'}</p></div></div><div className="action-links"><button onClick={hint} disabled={solved}>给我一点灵感 <span>↗</span></button><button onClick={reveal}>看看参考拼法 <span>↗</span></button></div></section>
    <section className={'collection'+(calendar?' open':'')}><button className="collection-toggle" onClick={()=>setCalendar(!calendar)} aria-expanded={calendar}><div><span className="collection-icon">▦</span><span><strong>我的木作日历</strong><small>把拼好的日子，慢慢收集起来</small></span></div><span className="collection-count">本月 {collected} 枚印章 <b>{calendar?'−':'＋'}</b></span></button>
      {calendar&&<div className="calendar-body"><div className="calendar-top"><div><button onClick={()=>setCalendarMonth(new Date(year,month-1,1))} aria-label="上个月">‹</button><strong>{year} 年 {month+1} 月</strong><button onClick={()=>setCalendarMonth(new Date(year,month+1,1))} aria-label="下个月">›</button></div><button className="today-button" onClick={()=>changeDate(formatDateInput(new Date()))}>回到今天</button></div><div className="calendar-grid">{['一','二','三','四','五','六','日'].map(d=><span className="weekday" key={d}>{d}</span>)}{Array.from({length:offset},(_,i)=><span key={'empty'+i}/>)}{Array.from({length:days},(_,i)=>{const d=i+1,dateKey=monthPrefix+String(d).padStart(2,'0'),stamp=session.store.stamps[dateKey],season=seasonFor(new Date(year,month,d));return <button key={d} className={'calendar-day'+(dateKey===key?' selected':'')} aria-label={dateKey+(stamp==='independent'?' 独立完成':stamp==='assisted'?' 辅助完成':stamp==='viewed'?' 已看答案':' 未完成')} onClick={()=>changeDate(dateKey)}>{stamp?<StampMark kind={stamp} season={season} day={d}/>:<span>{d}</span>}</button>;})}</div><div className="calendar-legend"><span><i className="legend-dot independent"/>独立完成</span><span><i className="legend-dot assisted"/>灵感相助</span><span><i className="legend-dot viewed"/>看过答案</span></div></div>}
    </section><footer className="footer"><span>木日 · 把时间，慢慢拼好。</span><span>四季有序，日子有光。 / {session.date.getFullYear()}</span></footer>
  </main>;
}
