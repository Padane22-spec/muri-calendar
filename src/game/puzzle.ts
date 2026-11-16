export type Cell = readonly [number, number];
export type Placement = { id: number; rotation: number; flipped: boolean; x: number; y: number };
export type PieceDefinition = { name: string; cells: Cell[]; color: string };
export const CELL = 1;
export const ROW_LENGTHS = [6, 6, 7, 7, 7, 7, 3];
export const BOARD: Cell[] = ROW_LENGTHS.flatMap((length, y) => Array.from({ length }, (_, x) => [x, y] as Cell));
export const MONTH_CELLS = BOARD.slice(0, 12);
export const DAY_CELLS = BOARD.slice(12);
export const PIECES: PieceDefinition[] = [
  { name: '长阶', cells: [[0,0],[0,1],[0,2],[0,3],[1,3]], color: '#cf9b65' },
  { name: '小屋', cells: [[0,0],[1,0],[0,1],[1,1],[0,2]], color: '#bd8956' },
  { name: '枝桠', cells: [[0,0],[0,1],[1,1],[0,2],[0,3]], color: '#d9ac78' },
  { name: '折径', cells: [[0,0],[0,1],[1,1],[1,2],[1,3]], color: '#c99361' },
  { name: '山谷', cells: [[0,0],[0,1],[0,2],[1,2],[2,2]], color: '#c28d58' },
  { name: '小桥', cells: [[0,0],[2,0],[0,1],[1,1],[2,1]], color: '#d4a16b' },
  { name: '曲流', cells: [[0,0],[1,0],[1,1],[1,2],[2,2]], color: '#ba8351' },
  { name: '方田', cells: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]], color: '#d3a575' },
];
export const PIECE_COUNT = PIECES.length;
export const cellKey = ([x, y]: Cell) => x + ',' + y;
export function normalize(cells: Cell[]): Cell[] {
  const minX = Math.min(...cells.map(c => c[0])); const minY = Math.min(...cells.map(c => c[1]));
  return cells.map(([x,y]) => [x-minX,y-minY] as Cell).sort((a,b) => a[1]-b[1] || a[0]-b[0]);
}
export function transform(cells: Cell[], rotation: number, flipped: boolean): Cell[] {
  let result = cells.map(([x,y]) => [flipped ? -x : x,y] as Cell);
  for (let i = 0; i < ((rotation % 4)+4)%4; i++) result = result.map(([x,y]) => [-y,x]);
  return normalize(result);
}
export function placedCells(p: Placement): Cell[] { return transform(PIECES[p.id].cells, p.rotation, p.flipped).map(([x,y]) => [x+p.x,y+p.y]); }
export const boardKeys = new Set(BOARD.map(cellKey));
export function getGoal(date: Date): Cell[] { return [MONTH_CELLS[date.getMonth()], DAY_CELLS[date.getDate()-1]]; }
export function canPlace(p: Placement, placed: Placement[], goal: Cell[]): boolean {
  const blocked = new Set([...goal, ...placed.filter(other => other.id !== p.id).flatMap(placedCells)].map(cellKey));
  return placedCells(p).every(c => boardKeys.has(cellKey(c)) && !blocked.has(cellKey(c)));
}
export function isSolved(placed: Placement[], goal: Cell[]): boolean {
  return placed.length === PIECE_COUNT && new Set(placed.map(p=>p.id)).size === PIECE_COUNT && placed.every(p=>canPlace(p,placed,goal));
}
export function formatDateInput(date: Date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
export function parseDateInput(value: string) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }

type Candidate = { placement: Placement; indices: number[] };
const cellIndices = new Map(BOARD.map((c,i)=>[cellKey(c),i]));
const candidates: Candidate[] = [];
const byCell: Candidate[][] = BOARD.map(()=>[]);
for (let id = 0; id < PIECES.length; id++) {
  const seen = new Set<string>();
  for (const flipped of [false,true]) for (let rotation=0;rotation<4;rotation++) {
    const cells = transform(PIECES[id].cells,rotation,flipped);
    const signature = JSON.stringify(cells);
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (let y=0;y<7;y++) for (let x=0;x<7;x++) {
      const indices = cells.map(([cx,cy])=>cellIndices.get(cellKey([cx+x,cy+y])));
      if (indices.some(i=>i===undefined)) continue;
      const candidate = { placement:{id,rotation,flipped,x,y},indices:indices as number[] };
      candidates.push(candidate);
      for (const i of candidate.indices) byCell[i].push(candidate);
    }
  }
}
export function solve(goal: Cell[], fixed: Placement[] = [], maxNodes = 2_000_000): Placement[] | null {
  const occupied = new Uint8Array(BOARD.length);
  for (const cell of goal) { const i=cellIndices.get(cellKey(cell)); if(i===undefined) return null; occupied[i]=1; }
  let used = 0;
  for (const p of fixed) {
    if ((used & (1<<p.id)) || !canPlace(p,fixed,goal)) return null;
    used |= 1<<p.id;
    for (const cell of placedCells(p)) occupied[cellIndices.get(cellKey(cell))!]=1;
  }
  const solution = [...fixed]; let nodes = 0;
  function search(mask: number): boolean {
    if (++nodes > maxNodes) return false;
    if (mask === (1<<PIECE_COUNT)-1) return true;
    let best: Candidate[] | null = null;
    for (let i=0;i<BOARD.length;i++) {
      if (occupied[i]) continue;
      const possible = byCell[i].filter(c => !(mask & (1<<c.placement.id)) && c.indices.every(j=>!occupied[j]));
      if (!possible.length) return false;
      if (!best || possible.length < best.length) best=possible;
      if (best.length===1) break;
    }
    if (!best) return false;
    for (const c of best) {
      c.indices.forEach(i=>occupied[i]=1); solution.push(c.placement);
      if(search(mask | (1<<c.placement.id))) return true;
      solution.pop(); c.indices.forEach(i=>occupied[i]=0);
    }
    return false;
  }
  return search(used) ? solution : null;
}
