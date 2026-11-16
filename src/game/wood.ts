import * as THREE from 'three';

export function woodMaterial(color: string, seed: number, roughness = 0.78) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256);
  let value = seed >>> 0;
  const random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
  for (let i = 0; i < 70; i += 1) {
    const y = random() * 256;
    ctx.beginPath(); ctx.moveTo(0, y);
    ctx.bezierCurveTo(64, y + random() * 7, 190, y - random() * 7, 256, y + random() * 3);
    ctx.strokeStyle = random() > 0.5 ? 'rgba(79,43,21,.12)' : 'rgba(255,229,184,.17)';
    ctx.lineWidth = 0.4 + random() * 1.7; ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
}
