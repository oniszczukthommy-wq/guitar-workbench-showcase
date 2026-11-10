self.exports={};
importScripts('/assets/mediapipe/vision_bundle.classic.js');
const {FilesetResolver,HandLandmarker}=self.exports;
let detector;
self.onmessage=async ({data})=>{
  try{
    if(data.type==='init'){
      const files=await FilesetResolver.forVisionTasks('/assets/mediapipe/wasm');
      detector=await HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/assets/mediapipe/hand_landmarker.task'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.55,minHandPresenceConfidence:.55,minTrackingConfidence:.55});
      self.postMessage({type:'ready'});
    }else if(data.type==='frame'){
      const result=detector.detectForVideo(data.bitmap,data.timestamp);data.bitmap.close();
      self.postMessage({type:'result',landmarks:result.landmarks,handedness:result.handedness,timestamp:data.timestamp});
    }
  }catch(error){data.bitmap?.close();self.postMessage({type:'error',message:error.message});}
};
