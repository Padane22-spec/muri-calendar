import { useEffect, useMemo, useRef, useState } from 'react';
import { PuzzleScene, type GameState } from './game/Scene';
import { formatDateInput, getGoal, parseDateInput, solve } from './game/puzzle';

const longDate=(d:Date)=>new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(d);
export default function App(){
  const mount=useRef<HTMLDivElement>(null);const scene=useRef<PuzzleScene|null>(null);
  const [date,setDate]=useState(()=>new Date());
  const [game,setGame]=useState<GameState>({placed:0,solved:false,moves:0,selected:null,message:'挑一块木头，开始今天的拼图。'});
  const [notice,setNotice]=useState('');
  const [help,setHelp]=useState(false);
  const dateGoal=useMemo(()=>getGoal(date),[date]);
  useEffect(()=>{
    if(!mount.current)return;
    try{
      const gameScene=new PuzzleScene(mount.current,date,setGame);scene.current=gameScene;
      return()=>{scene.current=null;gameScene.dispose();};
    }catch{setNotice('3D 画面未能启动，请开启浏览器的硬件加速后刷新页面。');}
  },[]);
  function changeDate(value:string){if(!value)return;const next=parseDateInput(value);if(!Number.isFinite(next.getTime()))return;setDate(next);scene.current?.reset(next);setNotice('');}
  function hint(){
    const fixed=scene.current?.getPlacements()??[];
    const answer=solve(dateGoal,fixed);
    if(answer){scene.current?.applySolution(answer,true);setNotice('');}
    else setNotice('目前的摆法暂时接不上完整答案。试着移开几块，再获取灵感。');
  }
  function showSolution(){const answer=solve(dateGoal);if(answer){scene.current?.applySolution(answer);setNotice('');}}
  const completion=game.solved;
  return <main className="page">
    <header className="header">
      <a className="brand" href="#top"><span className="brand-mark">木</span><span>木日</span><i/><small>CALENDAR PUZZLE</small></a>
      <div className="header-right"><span className="live-dot"/>每日一局 · 慢慢拼就好<button className="help-button" onClick={()=>setHelp(!help)} aria-label="操作说明">?</button></div>
    </header>
    <section className="intro" id="top">
      <div className="intro-copy"><div className="eyebrow"><span>ONE DAY, ONE PUZZLE</span><i/><span>木质日历拼图</span></div><h1>把今天，拼出来。</h1><p>留住月份与日期，让每一块木头找到自己的位置。</p></div>
      <div className="date-card"><div className="date-stamp">今<br/>日</div><div className="date-copy"><small>每日挑战</small><strong>{longDate(date)}</strong></div><label className="date-picker" title="选择挑战日期"><span>▦</span><input type="date" value={formatDateInput(date)} onChange={e=>changeDate(e.target.value)} aria-label="选择挑战日期"/></label></div>
    </section>
    {help&&<aside className="help-panel"><strong>只留下两格，就是今天。</strong><p>用 8 块固定形状的木块盖住底盘，仅露出目标月份与日期。悬停轻轻拿起，按住左键拖动，滚轮每次旋转 90°，右键翻转。绿色预览可以放下，红色预览需要调整。也可以用 R 旋转、F 翻转、Esc 取消拖动。</p><button onClick={()=>setHelp(false)}>知道了</button></aside>}
    <section className={'game-panel'+(completion?' complete':'')} aria-label="日历拼图游戏">
      <div className="panel-head">
        <div className="board-heading"><span className="board-glyph">▦</span><div><strong>日历底盘</strong><small>8 块木头 · 1 个今天</small></div><span className="wood-pill"><i/> 自然木纹</span></div>
        <div className="goal-chips"><span>留下</span><b>{date.getMonth()+1}<small>月</small></b><b>{date.getDate()}<small>日</small></b></div>
        <div className="progress-area"><div className="progress-top"><span>拼图进度</span><strong>{game.placed}<small> / 8</small></strong></div><div className="progress-line"><i style={{width:(game.placed/8*100)+'%'}}/></div></div>
        <button className="reset-button" onClick={()=>{scene.current?.reset(date);setNotice('');}}><span>↺</span>重置</button>
      </div>
      <div className="scene-wrap" ref={mount}/>
      <div className="panel-foot"><div className={'game-message'+(completion?' win':'')} role="status"><span className="message-glyph">{completion?'✓':'✳'}</span><span>{notice||(completion?(date.getMonth()+1)+' 月 '+date.getDate()+' 日，拼好了。今天的时间属于你。':game.message)}</span></div><div className="controls"><span>左键拖动</span><b>·</b><span>滚轮旋转</span><b>·</b><span>右键翻转</span></div></div>
    </section>
    <section className="lower-row"><div className="daily-note"><div className="note-mark">“</div><div><strong>一日，一拼。</strong><p>每天的答案都不一样。<br/>留一点时间，给自己和一块木头。</p></div></div><div className="action-links"><button onClick={hint} disabled={completion}>给我一点灵感 <span>↗</span></button><button onClick={showSolution}>看看参考拼法 <span>↗</span></button></div></section>
    <footer className="footer"><span>木日 · 把时间，慢慢拼好。</span><span>每天的新挑战 · {date.getFullYear()}</span></footer>
  </main>
}
