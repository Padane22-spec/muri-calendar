import * as THREE from 'three';

function randomFor(seed:number){let value=seed>>>0;return()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};}
export function woodMaterial(color:string,seed:number,roughness=.62){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d')!;const random=randomFor(seed);
  ctx.fillStyle=color;ctx.fillRect(0,0,512,512);
  // Uneven growth rings follow one continuous field across the entire piece.
  const phase=random()*9;const knotX=120+random()*260,knotY=random()*512;
  for(let line=-100;line<650;line+=1.4+random()*2){
    const dark=random()>.32;
    ctx.strokeStyle=dark?'rgba(57,29,15,'+(.015+random()*.09)+')':'rgba(255,240,197,'+(.02+random()*.12)+')';
    ctx.lineWidth=.3+random()*1.3;ctx.beginPath();
    for(let y=0;y<=512;y+=4){
      const distance=Math.abs(line-knotX);
      const bend=Math.exp(-distance/50)*Math.sin((y-knotY)/50)*16;
      const x=line+Math.sin(y/160+phase+line/130)*7+Math.sin(y/42+phase)*.7+bend;
      if(y===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  // Fine pores make the surface react subtly to the light rather than stripes.
  for(let i=0;i<5500;i++){
    ctx.fillStyle=random()>.4?'rgba(45,27,14,.035)':'rgba(255,245,222,.06)';
    ctx.fillRect(random()*512,random()*512,.4+random(),1+random()*3);
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=8;
  const bump=new THREE.CanvasTexture(canvas);bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.anisotropy=8;
  return new THREE.MeshStandardMaterial({map,bumpMap:bump,bumpScale:.012,roughness,metalness:0});
}
