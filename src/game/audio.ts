export class WoodAudio {
  private context:AudioContext|null=null;
  muted=false;
  unlock(){if(this.muted)return;try{this.context??=new AudioContext();void this.context.resume().catch(()=>{});}catch{/* silent fallback */}}
  play(kind:'pick'|'drop'|'win'){
    if(this.muted||!this.context||document.hidden||!document.hasFocus())return;
    const ctx=this.context;const start=ctx.currentTime;
    const tones=kind==='win'?[523,659,784]:[kind==='pick'?480:240];
    tones.forEach((frequency,index)=>{
      const time=start+index*.12;const osc=ctx.createOscillator();const gain=ctx.createGain();
      osc.type=kind==='win'?'sine':'triangle';osc.frequency.setValueAtTime(frequency,time);osc.frequency.exponentialRampToValueAtTime(frequency*.62,time+.09);
      gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.035,time+.003);gain.gain.exponentialRampToValueAtTime(.0001,time+.18);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(time);osc.stop(time+.2);osc.onended=()=>{osc.disconnect();gain.disconnect();};
    });
  }
  dispose(){void this.context?.close();this.context=null;}
}
