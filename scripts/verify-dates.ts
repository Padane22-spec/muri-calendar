import { getGoal, isSolved, solve, formatDateInput } from '../src/game/puzzle.ts';
const start=Date.now(); const failures:string[]=[];
for(let month=0;month<12;month++){
  const days=new Date(2024,month+1,0).getDate();
  for(let day=1;day<=days;day++){
    const date=new Date(2024,month,day);const goal=getGoal(date);const solution=solve(goal);
    if(!solution||!isSolved(solution,goal))failures.push(formatDateInput(date));
  }
}
console.log(JSON.stringify({dates:366,failures,elapsedMs:Date.now()-start},null,2));
if(failures.length)process.exitCode=1;
