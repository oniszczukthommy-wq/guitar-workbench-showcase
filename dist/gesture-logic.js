export const HAND_CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const alpha=(cutoff,dt)=>{const tau=1/(2*Math.PI*cutoff);return 1/(1+tau/dt);};
// One Euro filter: settle jitter while the hand is still, then raise the
// cutoff during a fast strum so the smoothing does not blunt the attack.
class AdaptivePointFilter{
  constructor(){this.reset();}
  reset(){this.value=null;this.raw=null;this.derivative=0;this.time=null;}
  update(value,time){
    if(this.value===null||this.time===null){this.value=value;this.raw=value;this.time=time;return value;}
    const dt=Math.max(.008,Math.min(.1,(time-this.time)/1000));
    const rawDerivative=(value-this.raw)/dt;this.raw=value;
    this.derivative+=alpha(1,dt)*(rawDerivative-this.derivative);
    const cutoff=3+1.8*Math.abs(this.derivative);
    this.value+=alpha(cutoff,dt)*(value-this.value);this.time=time;
    return this.value;
  }
}
export function fingerNumber(points){
  const thumb=dist(points[4],points[17])>dist(points[3],points[17])*1.15;
  const fingers=[8,12,16,20].map(tip=>dist(points[tip],points[0])>dist(points[tip-2],points[0])*1.16);
  if(thumb&&fingers[3]&&!fingers[0]&&!fingers[1]&&!fingers[2])return 6;
  return Number(thumb)+fingers.filter(Boolean).length;
}
export class GestureLogic {
  constructor(){this.reset();}
  reset(){this.pending=0;this.since=0;this.selected=0;this.right=null;this.lastStrum=-Infinity;this.pinchArmed=false;this.rightMotion=new AdaptivePointFilter();}
  update(landmarks,time,method='wave'){
    const actions={choose:null,strum:null,left:null,right:null};
    const hands=landmarks.map(points=>({points,x:1-points[9].x}));
    const left=hands.filter(h=>h.x<.5).sort((a,b)=>a.x-b.x)[0];
    const right=hands.filter(h=>h.x>=.5).sort((a,b)=>b.x-a.x)[0];
    if(left){const number=fingerNumber(left.points);actions.left=number;if(number!==this.pending){this.pending=number;this.since=time;}else if(number>0&&number<=6&&time-this.since>=280&&number!==this.selected){this.selected=number;actions.choose=number;}}
    else{this.pending=0;this.selected=0;}
    if(right){
      const p=right.points;const size=dist(p[0],p[9]);const pinch=dist(p[4],p[8])/Math.max(size,.001);actions.right=pinch<.4?'pinched':'open';
      if(pinch<.4)this.pinchArmed=true;
      if(method==='pinch'&&this.pinchArmed&&pinch>.65){if(time-this.lastStrum>180){actions.strum='down';this.lastStrum=time;}this.pinchArmed=false;}
      const filteredY=this.rightMotion.update(p[0].y,time);
      const previous=this.right;
      if(previous&&time-previous.time<400&&time-this.lastStrum>180){
        if(method==='wave'){const dy=filteredY-previous.y;const dt=(time-previous.time)/1000;if(Math.abs(dy)>.035&&Math.abs(dy)/Math.max(dt,.01)>.4){actions.strum=dy>0?'down':'up';this.lastStrum=time;}}
      }
      this.right={y:filteredY,pinch,time};
    }else{this.right=null;this.pinchArmed=false;this.rightMotion.reset();}
    return actions;
  }
}
