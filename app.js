(() => {
  const rootNames = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const pitchClass = Object.fromEntries(rootNames.map((n,i)=>[n,i]));
  const enharmonic = { 'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb' };

  const forms = {
    basic: [1,1,1,1,4,4,1,1,5,4,1,5],
    quick: [1,4,1,1,4,4,1,1,5,4,1,5],
    jazz: [1,4,1,6,2,5,1,6,2,5,1,5]
  };

  const degreeSemitones = {1:0,2:2,3:4,4:5,5:7,6:9};
  const roleNames = {1:'I',2:'ii',3:'iii',4:'IV',5:'V',6:'VI'};

  const els = {
    key: document.querySelector('#keySelect'), form: document.querySelector('#formSelect'), tempo: document.querySelector('#tempo'),
    complexity: document.querySelector('#complexity'), density: document.querySelector('#density'), voiceLeading: document.querySelector('#voiceLeading'),
    tempoOutput: document.querySelector('#tempoOutput'), complexityOutput: document.querySelector('#complexityOutput'), densityOutput: document.querySelector('#densityOutput'),
    voiceLeadingOutput: document.querySelector('#voiceLeadingOutput'), progression: document.querySelector('#progression'), title: document.querySelector('#progressionTitle'),
    status: document.querySelector('#status'), play: document.querySelector('#playButton'), stop: document.querySelector('#stopButton'), regenerate: document.querySelector('#regenerateButton'),
    detailChord: document.querySelector('#detailChord'), detailNotes: document.querySelector('#detailNotes'), leslie: document.querySelector('#leslie')
  };

  let progression = [];
  let audioContext = null;
  let master = null;
  let timer = null;
  let playing = false;
  let activeBar = -1;
  let barStartTime = 0;

  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const midiName = midi => `${rootNames[((midi % 12) + 12) % 12]}${Math.floor(midi/12)-1}`;
  const normalizeRoot = n => enharmonic[n] || n;
  const rootForDegree = (key, degree) => rootNames[(pitchClass[key] + degreeSemitones[degree]) % 12];

  function vocabulary(complexity, degree, form) {
    const pool = [{name:'7', intervals:[0,4,7,10], weight:10}];
    if (complexity >= 12) pool.push({name:'9', intervals:[0,4,10,14], weight:8});
    if (complexity >= 28) pool.push({name:'13', intervals:[0,4,10,14,21], weight:7});
    if (complexity >= 42) pool.push({name:'7#9', intervals:[0,4,10,15], weight:5});
    if (complexity >= 52) pool.push({name:'9sus4', intervals:[0,5,10,14], weight:4});
    if (complexity >= 62) pool.push({name:'13b9', intervals:[0,4,10,13,21], weight:4});
    if (complexity >= 72) pool.push({name:'7b9', intervals:[0,4,10,13], weight:4});
    if (complexity >= 82) pool.push({name:'7#5#9', intervals:[0,4,8,10,15], weight:3});
    if (form === 'jazz' && [2,3].includes(degree)) {
      pool.unshift({name:'m7', intervals:[0,3,7,10], weight:10});
      if (complexity > 35) pool.unshift({name:'m9', intervals:[0,3,10,14], weight:8});
    }
    if (form === 'jazz' && degree === 6) {
      pool.unshift({name:'7b9', intervals:[0,4,10,13], weight:10});
    }
    return pool;
  }

  function weightedPick(items) {
    const total = items.reduce((s,x)=>s+x.weight,0);
    let r = Math.random()*total;
    for (const item of items) { r -= item.weight; if (r <= 0) return item; }
    return items[items.length-1];
  }

  function chooseQuality(complexity, density, degree, barIndex, form) {
    const richChance = density / 100;
    const structuralBoost = [3,7,8,9,11].includes(barIndex) ? 0.18 : 0;
    if (Math.random() > clamp(richChance + structuralBoost,0,1)) return {name:'7', intervals:[0,4,7,10]};
    return weightedPick(vocabulary(complexity, degree, form));
  }

  function candidateVoicings(rootPc, intervals) {
    const pitchClasses = [...new Set(intervals.map(i => (rootPc + i) % 12))];
    const result = [];
    for (let anchor = 45; anchor <= 61; anchor += 2) {
      const notes = pitchClasses.map(pc => {
        let midi = anchor + ((pc - anchor) % 12 + 12) % 12;
        while (midi < 48) midi += 12;
        while (midi > 76) midi -= 12;
        return midi;
      }).sort((a,b)=>a-b);
      for (let shift=-1; shift<=1; shift++) {
        const shifted = notes.map((n,i)=> i===0 ? n + shift*12 : n).sort((a,b)=>a-b);
        if (shifted[0] >= 43 && shifted[shifted.length-1] <= 79) result.push(shifted);
      }
    }
    const unique = new Map(result.map(v => [v.join(','),v]));
    return [...unique.values()];
  }

  function voiceDistance(a,b) {
    if (!a) return 0;
    const aa=[...a], bb=[...b];
    while (aa.length < bb.length) aa.push(aa[aa.length-1]+12);
    while (bb.length < aa.length) bb.push(bb[bb.length-1]+12);
    return aa.reduce((sum,n,i)=>sum+Math.abs(n-bb[i]),0);
  }

  function chooseVoicing(rootPc, intervals, previous, depth) {
    const candidates = candidateVoicings(rootPc, intervals);
    if (!previous || depth <= 3) {
      const basic = candidates.find(v => v.some(n => n % 12 === rootPc));
      return basic || candidates[0];
    }
    const centerTarget = 61;
    const scored = candidates.map(v => {
      const move = voiceDistance(previous,v);
      const center = v.reduce((a,b)=>a+b,0)/v.length;
      const spread = v[v.length-1]-v[0];
      const repetitionPenalty = v.join(',') === previous.join(',') ? 8 : 0;
      const score = move*(depth/100) + Math.abs(center-centerTarget)*0.3 + Math.max(0,spread-24)*0.25 + repetitionPenalty*(depth/100);
      return {v,score};
    }).sort((a,b)=>a.score-b.score);
    const looseness = Math.floor((100-depth)/25);
    const top = scored.slice(0,Math.max(1,1+looseness));
    return top[Math.floor(Math.random()*top.length)].v;
  }

  function maybeSubstitute(degree, complexity, density, bar) {
    if (complexity < 68 || density < 45) return degree;
    if (bar === 5 && degree === 4 && Math.random() < density/180) return 'dim';
    return degree;
  }

  function buildProgression() {
    stop();
    const key = normalizeRoot(els.key.value);
    const form = els.form.value;
    const complexity = Number(els.complexity.value);
    const density = Number(els.density.value);
    const voiceDepth = Number(els.voiceLeading.value);
    let previous = null;

    progression = forms[form].map((degree, bar) => {
      const substituted = maybeSubstitute(degree,complexity,density,bar);
      if (substituted === 'dim') {
        const root = rootForDegree(key,4);
        const rootPc = (pitchClass[root] + 1) % 12;
        const quality = {name:'dim7', intervals:[0,3,6,9]};
        const voicing = chooseVoicing(rootPc,quality.intervals,previous,voiceDepth);
        previous = voicing;
        return {bar,degree:'passing',role:'chromatic',root:rootNames[rootPc],quality,voicing};
      }
      const root = rootForDegree(key,degree);
      const quality = chooseQuality(complexity,density,degree,bar,form);
      const voicing = chooseVoicing(pitchClass[root],quality.intervals,previous,voiceDepth);
      previous = voicing;
      return {bar,degree,role:roleNames[degree],root,quality,voicing};
    });

    els.title.textContent = `12 bars in ${key}`;
    renderProgression();
    els.status.textContent = 'Regenerated.';
  }

  function renderProgression() {
    els.progression.innerHTML = '';
    progression.forEach((chord,index) => {
      const button = document.createElement('button');
      button.type='button';
      button.className='bar';
      button.dataset.bar=String(index+1);
      button.innerHTML = `<span class="chord-role">${chord.role}</span><span class="chord-name">${chord.root}${chord.quality.name}</span><span class="chord-notes">${chord.voicing.map(midiName).join(' · ')}</span>`;
      button.addEventListener('click',()=>selectBar(index));
      els.progression.appendChild(button);
    });
  }

  function selectBar(index) {
    document.querySelectorAll('.bar').forEach((b,i)=>b.classList.toggle('selected',i===index));
    const chord=progression[index];
    els.detailChord.textContent=`Bar ${index+1}: ${chord.root}${chord.quality.name}`;
    els.detailNotes.textContent=`Voicing: ${chord.voicing.map(midiName).join(', ')}. Role: ${chord.role}.`;
  }

  function createAudio() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    master = audioContext.createGain();
    master.gain.value = 0.2;
    master.connect(audioContext.destination);
  }

  function drawbarLevels() {
    return [...document.querySelectorAll('[data-drawbar]')].map(x=>Number(x.value)/8);
  }

  function playOrganNote(midi,start,duration,velocity=1) {
    const ctx=audioContext;
    const freq=440*Math.pow(2,(midi-69)/12);
    const gain=ctx.createGain();
    const filter=ctx.createBiquadFilter();
    filter.type='lowpass'; filter.frequency.value=4200; filter.Q.value=.5;
    const leslie=els.leslie.checked;
    const pan=ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const levels=drawbarLevels();
    const ratios=[0.5,1.5,1,2,3,4];
    const oscs=[];

    levels.forEach((level,i)=>{
      if (level <= 0) return;
      const osc=ctx.createOscillator();
      const partialGain=ctx.createGain();
      osc.type='sine'; osc.frequency.value=freq*ratios[i];
      partialGain.gain.value=level*(i===2?0.32:0.12);
      osc.connect(partialGain); partialGain.connect(filter); oscs.push(osc);
    });

    filter.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(0.45*velocity,start+0.025);
    gain.gain.setValueAtTime(0.38*velocity,start+Math.max(.05,duration-.12));
    gain.gain.linearRampToValueAtTime(0,start+duration);
    if (pan && leslie) {
      const phase=(start*2.4)%6.28;
      pan.pan.setValueAtTime(Math.sin(phase)*.2,start);
      pan.pan.linearRampToValueAtTime(Math.sin(phase+2.8)*.2,start+duration);
    }
    oscs.forEach(o=>{o.start(start);o.stop(start+duration+.03);});
  }

  function scheduleBar(index,start,secondsPerBar) {
    const chord=progression[index];
    const attackOffset = index === 0 ? 0 : 0.012;
    chord.voicing.forEach((note,i)=>playOrganNote(note,start+attackOffset+i*.007,secondsPerBar*.82,1-(i*.04)));
  }

  function updateActiveBar(index) {
    activeBar=index;
    document.querySelectorAll('.bar').forEach((b,i)=>b.classList.toggle('active',i===index));
    els.status.textContent=`Playing bar ${index+1} of 12`;
  }

  async function play() {
    createAudio();
    if (audioContext.state === 'suspended') await audioContext.resume();
    stop(false);
    playing=true;
    const tempo=Number(els.tempo.value);
    const secondsPerBeat=60/tempo;
    const secondsPerBar=secondsPerBeat*4;
    barStartTime=audioContext.currentTime+.08;
    progression.forEach((_,i)=>scheduleBar(i,barStartTime+i*secondsPerBar,secondsPerBar));
    updateActiveBar(0);
    const startedAt=performance.now()+80;
    timer=setInterval(()=>{
      const elapsed=(performance.now()-startedAt)/1000;
      const index=Math.floor(elapsed/secondsPerBar);
      if (index>=12) { stop(); return; }
      if (index!==activeBar) updateActiveBar(index);
    },40);
  }

  function stop(updateStatus=true) {
    if (timer) clearInterval(timer);
    timer=null; playing=false; activeBar=-1;
    document.querySelectorAll('.bar').forEach(b=>b.classList.remove('active'));
    if (master && audioContext) {
      try { master.gain.cancelScheduledValues(audioContext.currentTime); master.gain.setValueAtTime(0.2,audioContext.currentTime); } catch (_) {}
    }
    if (updateStatus) els.status.textContent='Stopped.';
  }

  function syncOutputs() {
    els.tempoOutput.value=els.tempo.value;
    els.complexityOutput.value=els.complexity.value;
    els.densityOutput.value=els.density.value;
    els.voiceLeadingOutput.value=els.voiceLeading.value;
  }

  [els.tempo,els.complexity,els.density,els.voiceLeading].forEach(input=>input.addEventListener('input',syncOutputs));
  [els.key,els.form].forEach(input=>input.addEventListener('change',buildProgression));
  [els.complexity,els.density,els.voiceLeading].forEach(input=>input.addEventListener('change',buildProgression));
  els.regenerate.addEventListener('click',buildProgression);
  els.play.addEventListener('click',play);
  els.stop.addEventListener('click',()=>stop());

  syncOutputs();
  buildProgression();
})();
