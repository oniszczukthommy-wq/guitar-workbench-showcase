import {GestureLogic,HAND_CONNECTIONS} from './gesture-logic.js';
export class CameraHands {
  constructor(video,canvas,callbacks){this.video=video;this.canvas=canvas;this.callbacks=callbacks;this.logic=new GestureLogic();this.active=false;this.busy=false;this.method='wave';this.generation=0;this.smoothedLandmarks=null;this.lastStatus='';this.lastInferenceAt=0;}
  async start(){
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('摄像头需要 HTTPS 或电脑上的 localhost。当前地址可以继续使用屏幕弹奏。');
    const generation=++this.generation;
    try{
      // Ask for a low-latency 60 fps feed where the camera supports it. The
      // worker remains back-pressured, so faster capture never queues stale frames.
      this.stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:30,max:30},facingMode:'user'},audio:false});
      if(generation!==this.generation){this.stream.getTracks().forEach(t=>t.stop());return;}
      this.video.srcObject=this.stream;await this.video.play();
      this.callbacks.status('准备手势识别…');
      this.worker=new Worker('/hand-worker.js');
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('手势模型加载超时，请重试')),45000);
        this.worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message||'手势识别启动失败'));};
        this.worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timeout);resolve();}else if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}};
        this.worker.postMessage({type:'init'});
      });
      if(generation!==this.generation)return;
      this.worker.onmessage=({data})=>{this.busy=false;if(!this.active)return;if(data.type==='error'){this.callbacks.error(data.message);this.stop();return;}if(data.type==='result'){this.draw(data.landmarks);const actions=this.logic.update(data.landmarks,data.timestamp,this.method);if(actions.choose)this.callbacks.choose(actions.choose);if(actions.strum)this.callbacks.strum(actions.strum);const status=data.landmarks.length?`识别到 ${data.landmarks.length} 只手`:'请将双手放入画面';if(status!==this.lastStatus){this.lastStatus=status;this.callbacks.status(status);}}};
      this.active=true;this.logic.reset();this.smoothedLandmarks=null;this.callbacks.started();this.loop();
    }catch(error){this.stop();if(error.name==='NotAllowedError')throw Error('尚未获得摄像头权限；可以允许后重试，或继续使用屏幕弹奏。');throw error;}
  }
  loop(){
    if(!this.active)return;
    if(this.video.requestVideoFrameCallback){
      this.raf=this.video.requestVideoFrameCallback((now,metadata)=>this.captureFrame(now,metadata));
    }else{
      this.raf=requestAnimationFrame(now=>this.captureFrame(now,null));
    }
  }
  async captureFrame(now,metadata){
    if(!this.active)return;
    // Stay in lockstep with camera frames. If inference is still running, skip
    // this frame instead of queuing stale images that add perceptible latency.
    const frameTime=metadata?.mediaTime!=null?metadata.mediaTime*1000:now;
    if(!this.busy&&this.video.readyState>=2&&frameTime-this.lastInferenceAt>=33){
      this.busy=true;
      try{
        const bitmap=await createImageBitmap(this.video);
        if(this.active){
          const timestamp=frameTime;this.lastInferenceAt=frameTime;
          this.worker.postMessage({type:'frame',bitmap,timestamp},[bitmap]);
        }else bitmap.close();
      }
      catch(error){this.busy=false;this.callbacks.error(error.message);this.stop();return;}
    }
    this.loop();
  }
  draw(landmarks){
    const width=this.video.videoWidth||960,height=this.video.videoHeight||540;
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const ctx=this.canvas.getContext('2d');ctx.clearRect(0,0,width,height);ctx.lineWidth=2;ctx.strokeStyle='#d2ed8c';ctx.fillStyle='#e8f6a8';
    // Smooth only the decorative skeleton. Gesture decisions below still use
    // the raw landmarks so quick strums do not acquire filter delay.
    if(!landmarks.length){this.smoothedLandmarks=null;return;}
    const alpha=.58;
    const display=landmarks.map((hand,hi)=>hand.map((p,pi)=>{
      const old=this.smoothedLandmarks?.[hi]?.[pi];
      return old?{x:old.x+(p.x-old.x)*alpha,y:old.y+(p.y-old.y)*alpha,z:old.z+(p.z-old.z)*alpha}:p;
    }));
    this.smoothedLandmarks=display;
    for(const hand of display){for(const [a,b]of HAND_CONNECTIONS){ctx.beginPath();ctx.moveTo((1-hand[a].x)*width,hand[a].y*height);ctx.lineTo((1-hand[b].x)*width,hand[b].y*height);ctx.stroke();}for(const p of hand){ctx.beginPath();ctx.arc((1-p.x)*width,p.y*height,3,0,Math.PI*2);ctx.fill();}}
  }
  stop(){this.generation++;this.active=false;if(this.video.cancelVideoFrameCallback&&this.raf!=null)this.video.cancelVideoFrameCallback(this.raf);cancelAnimationFrame(this.raf);this.worker?.terminate();this.worker=null;this.stream?.getTracks().forEach(t=>t.stop());this.video.srcObject=null;this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);this.smoothedLandmarks=null;this.lastStatus='';this.lastInferenceAt=0;this.busy=false;this.callbacks.stopped();}
}
