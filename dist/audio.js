const Tone=globalThis.Tone;
export class GuitarAudio {
  constructor(){this.promise=null;this.ready=false;this.volume=-8;this.sources=new Set();this.strings=Array(6).fill(null);}
  async load(onProgress=()=>{}){
    if(this.promise)return this.promise;
    this.promise=(async()=>{
      await Tone.start();
      const files=await fetch('/assets/samples.json').then(r=>r.json());
      this.output=new Tone.Gain(.65);
      this.highpass=new Tone.Filter(72,'highpass');
      this.eq=new Tone.EQ3(-1.5,-2,1);
      this.compressor=new Tone.Compressor({threshold:-20,ratio:2.2,attack:.012,release:.2});
      this.reverb=new Tone.Reverb({decay:1.4,wet:.12,preDelay:.015});
      this.master=new Tone.Volume(this.volume);
      this.limiter=new Tone.Limiter(-1).toDestination();
      this.recordDestination=Tone.getContext().rawContext.createMediaStreamDestination();
      this.output.chain(this.highpass,this.eq,this.compressor,this.reverb,this.master,this.limiter);
      this.limiter.connect(this.recordDestination);
      await this.reverb.generate();
      let loaded=0;
      this.bank=await Promise.all(files.map(async item=>{
        const response=await fetch('/assets/guitar-acoustic/'+encodeURIComponent(item.file));
        if(!response.ok)throw Error('音源下载失败：'+item.file);
        const data=await response.arrayBuffer();
        const buffer=await Tone.getContext().rawContext.decodeAudioData(data);
        const note=item.file.slice(0,-4).replace('s','#');
        onProgress(++loaded,files.length);
        return {midi:Tone.Frequency(note).toMidi(),buffer};
      }));
      this.ready=true;
    })().catch(error=>{this.promise=null;throw error;});
    return this.promise;
  }
  async unlock(){await Tone.start();}
  setVolume(db){this.volume=db;if(this.master)this.master.volume.rampTo(db,.04);}
  setSpace(wet){if(this.reverb)this.reverb.wet.rampTo(wet,.1);}
  pluck(string,midi,velocity=.75,delay=0){
    if(!this.ready||midi==null)return;
    const sample=this.bank.reduce((a,b)=>Math.abs(b.midi-midi)<Math.abs(a.midi-midi)?b:a);
    const now=Tone.now()+delay;
    const old=this.strings[string];
    if(old){try{old.stop(now);}catch{}}
    const source=new Tone.ToneBufferSource({url:sample.buffer,playbackRate:2**((midi-sample.midi)/12),fadeIn:.002,fadeOut:.06}).connect(this.output);
    this.sources.add(source);this.strings[string]=source;
    source.onended=()=>{this.sources.delete(source);source.dispose();};
    source.start(now,0,undefined,Math.max(.1,Math.min(1,velocity))*.65);
  }
  strum(notes,direction='down',velocity=.75){
    const order=direction==='down'?[0,1,2,3,4,5]:[5,4,3,2,1,0];
    order.forEach((s,i)=>this.pluck(s,notes[s],velocity*(.92+i*.012),i*.015));
  }
  stop(){for(const source of this.sources){try{source.stop();}catch{}}this.strings.fill(null);}
}
