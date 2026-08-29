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
    key: document.querySelector('#keySelect'),
    form: document.querySelector('#formSelect'),
    tempo: document.querySelector('#tempo'),
    complexity: document.querySelector('#complexity'),
    density: document.querySelector('#density'),
    voiceLeading: document.querySelector('#voiceLeading'),
    tempoOutput: document.querySelector('#tempoOutput'),
    complexityOutput: document.querySelector('#complexityOutput'),
    densityOutput: document.querySelector('#densityOutput'),
    voiceLeadingOutput: document.querySelector('#voiceLeadingOutput'),
    progression: document.querySelector('#progression'),
    title: document.querySelector('#progressionTitle'),
    status: document.querySelector('#status'),
    play: document.querySelector('#playButton'),
    stop: document.querySelector('#stopButton'),
    regenerate: document.querySelector('#regenerateButton'),
    detailChord: document.querySelector('#detailChord'),
    detailNotes: document.querySelector('#detailNotes'),
    leslie: document.querySelector('#leslie')
  };

  let progression = [];
  let audioContext = null;
  let master = null;
  let timer = null;
  let activeBar = -1;

  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const midiName = midi => `${rootNames[((midi % 12) + 12) % 12]}${Math.floor(midi/12)-1}`;
  const normalizeRoot = n => enharmonic[n] || n;
  const rootForDegree = (key, degree) => rootNames[(pitchClass[key] + degreeSemitones[degree]) % 12];
  const sameVoicing = (a,b) => Boolean(a && b && a.length === b.length && a.every((n,i)=>n===b[i]));

  function baseQuality(degree, form) {
    if (form === 'jazz' && [2,3].includes(degree)) return {name:'m7', intervals:[0,3,7,10], weight:10};
    return {name:'7', intervals:[0,4,7,10], weight:10};
  }

  function vocabulary(complexity, degree, form) {
    const pool = [baseQuality(degree, form)];

    if (form === 'jazz' && [2,3].includes(degree)) {
      if (complexity >= 18) pool.push({name:'m9', intervals:[0,3,10,14], weight:8});
      if (complexity >= 58) pool.push({name:'m11', intervals:[0,3,10,14,17], weight:5});
      return pool;
    }

    if (complexity >= 12) pool.push({name:'9', intervals:[0,4,10,14], weight:8});
    if (complexity >= 28) pool.push({name:'13', intervals:[0,4,10,14,21], weight:7});
    if (complexity >= 42) pool.push({name:'7#9', intervals:[0,4,10,15], weight:5});
    if (complexity >= 52) pool.push({name:'9sus4', intervals:[0,5,10,14], weight:4});
    if (complexity >= 62) pool.push({name:'13b9', intervals:[0,4,10,13,21], weight:4});
    if (complexity >= 72) pool.push({name:'7b9', intervals:[0,4,10,13], weight:4});
    if (complexity >= 82) pool.push({name:'7#5#9', intervals:[0,4,8,10,15], weight:3});
    if (form === 'jazz' && degree === 6) pool.push({name:'7b9', intervals:[0,4,10,13], weight:10});

    return pool;
  }

  function weightedPick(items) {
    const total = items.reduce((s,x)=>s+x.weight,0);
    let r = Math.random()*total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return items[items.length-1];
  }

  function chooseQuality(complexity, density, degree, barIndex, form, previousChord, root) {
    const baseline = baseQuality(degree, form);
    const structuralBoost = [3,7,8,9,11].includes(barIndex) ? 0.18 : 0;
    const richChance = clamp((density / 100) + structuralBoost, 0, 1);
    const pool = vocabulary(complexity, degree, form);

    let candidates;
    if (Math.random() > richChance) {
      candidates = [baseline];
    } else {
      candidates = [...pool];
    }

    // A blues form may repeat the same harmonic function, but the realised chord
    // should evolve. If the same root was just heard and another legal colour is
    // available, remove the exact previous chord quality from this choice.
    if (previousChord && previousChord.root === root && candidates.length > 1) {
      const varied = candidates.filter(q => q.name !== previousChord.quality.name);
      if (varied.length) candidates = varied;
    }

    return candidates.length === 1 ? candidates[0] : weightedPick(candidates);
  }

  function candidateVoicings(rootPc, intervals) {
    const pitchClasses = [...new Set(intervals.map(i => (rootPc + i) % 12))];
    const result = [];

    for (let anchor = 43; anchor <= 63; anchor += 2) {
      const notes = pitchClasses.map(pc => {
        let midi = anchor + ((pc - anchor) % 12 + 12) % 12;
        while (midi < 46) midi += 12;
        while (midi > 77) midi -= 12;
        return midi;
      }).sort((a,b)=>a-b);

      for (let shift=-1; shift<=1; shift++) {
        const shifted = notes
          .map((n,i)=>i===0 ? n + shift*12 : n)
          .sort((a,b)=>a-b);

        if (shifted[0] >= 41 && shifted[shifted.length-1] <= 81) result.push(shifted);
      }
    }

    return [...new Map(result.map(v => [v.join(','),v])).values()];
  }

  function voiceDistance(a,b) {
    if (!a) return 0;
    const aa=[...a];
    const bb=[...b];
    while (aa.length < bb.length) aa.push(aa[aa.length-1]+12);
    while (bb.length < aa.length) bb.push(bb[bb.length-1]+12);
    return aa.reduce((sum,n,i)=>sum+Math.abs(n-bb[i]),0);
  }

  function chooseVoicing(rootPc, intervals, previous, depth) {
    let candidates = candidateVoicings(rootPc, intervals);

    // Never repeat the exact previous MIDI voicing when another valid realisation
    // exists. This is independent of voice-leading depth.
    if (previous && candidates.length > 1) {
      const nonRepeating = candidates.filter(v => !sameVoicing(v, previous));
      if (nonRepeating.length) candidates = nonRepeating;
    }

    if (!previous) {
      const centered = [...candidates].sort((a,b)=>{
        const ac = a.reduce((x,y)=>x+y,0)/a.length;
        const bc = b.reduce((x,y)=>x+y,0)/b.length;
        return Math.abs(ac-61)-Math.abs(bc-61);
      });
      return centered[0];
    }

    if (depth <= 3) {
      // Low depth deliberately preserves a root-position/static-inversion feel,
      // but still chooses a different register so the same bar is not duplicated.
      const rootPosition = candidates
        .filter(v => ((v[0] % 12) + 12) % 12 === rootPc)
        .sort((a,b)=>{
          const ac = a.reduce((x,y)=>x+y,0)/a.length;
          const bc = b.reduce((x,y)=>x+y,0)/b.length;
          return Math.abs(ac-61)-Math.abs(bc-61);
        });
      return rootPosition[0] || candidates[0];
    }

    const scored = candidates.map(v => {
      const move = voiceDistance(previous,v);
      const center = v.reduce((a,b)=>a+b,0)/v.length;
      const spread = v[v.length-1]-v[0];
      const score =
        move*(depth/100) +
        Math.abs(center-61)*0.3 +
        Math.max(0,spread-24)*0.25;
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
    stop(false);

    const key = normalizeRoot(els.key.value);
    const form = els.form.value;
    const complexity = Number(els.complexity.value);
    const density = Number(els.density.value);
    const voiceDepth = Number(els.voiceLeading.value);

    let previousVoicing = null;
    let previousChord = null;

    progression = forms[form].map((degree, bar) => {
      const substituted = maybeSubstitute(degree,complexity,density,bar);

      if (substituted === 'dim') {
        const root = rootForDegree(key,4);
        const rootPc = (pitchClass[root] + 1) % 12;
        const quality = {name:'dim7', intervals:[0,3,6,9]};
        const voicing = chooseVoicing(rootPc,quality.intervals,previousVoicing,voiceDepth);
        const chord = {bar,degree:'passing',role:'chromatic',root:rootNames[rootPc],quality,voicing};
        previousVoicing = voicing;
        previousChord = chord;
        return chord;
      }

      const root = rootForDegree(key,degree);
      const quality = chooseQuality(complexity,density,degree,bar,form,previousChord,root);
      const voicing = chooseVoicing(pitchClass[root],quality.intervals,previousVoicing,voiceDepth);
      const chord = {bar,degree,role:roleNames[degree],root,quality,voicing};

      previousVoicing = voicing;
      previousChord = chord;
      return chord;
    });

    els.title.textContent = `12 bars in ${key}`;
    renderProgression();
    els.status.textContent = 'Regenerated without repeated voicings.';
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
    filter.type='lowpass';
    filter.frequency.value=4200;
    filter.Q.value=.5;

    const movingLeslie=els.leslie.checked;
    const pan=ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const levels=drawbarLevels();
    const ratios=[0.5,1.5,1,2,3,4];
    const oscs=[];

    levels.forEach((level,i)=>{
      if (level <= 0) return;
      const osc=ctx.createOscillator();
      const partialGain=ctx.createGain();
      osc.type='sine';
      osc.frequency.value=freq*ratios[i];
      partialGain.gain.value=level*(i===2?0.32:0.12);
      osc.connect(partialGain);
      partialGain.connect(filter);
      oscs.push(osc);
    });

    filter.connect(gain);
    if (pan) {
      gain.connect(pan);
      pan.connect(master);
    } else {
      gain.connect(master);
    }

    gain.gain.setValueAtTime(0,start);
    gain.gain.linearRampToValueAtTime(0.45*velocity,start+0.025);
    gain.gain.setValueAtTime(0.38*velocity,start+Math.max(.05,duration-.12));
    gain.gain.linearRampToValueAtTime(0,start+duration);

    if (pan && movingLeslie) {
      const phase=(start*2.4)%6.28;
      pan.pan.setValueAtTime(Math.sin(phase)*.2,start);
      pan.pan.linearRampToValueAtTime(Math.sin(phase+2.8)*.2,start+duration);
    }

    oscs.forEach(o=>{
      o.start(start);
      o.stop(start+duration+.03);
    });
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
    stop(false);
    createAudio();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const tempo=Number(els.tempo.value);
    const secondsPerBeat=60/tempo;
    const secondsPerBar=secondsPerBeat*4;
    const startTime=audioContext.currentTime+.08;

    progression.forEach((_,i)=>scheduleBar(i,startTime+i*secondsPerBar,secondsPerBar));
    updateActiveBar(0);

    const startedAt=performance.now()+80;
    timer=setInterval(()=>{
      const elapsed=(performance.now()-startedAt)/1000;
      const index=Math.floor(elapsed/secondsPerBar);
      if (index>=12) {
        stop();
        return;
      }
      if (index!==activeBar) updateActiveBar(index);
    },40);
  }

  function stop(updateStatus=true) {
    if (timer) clearInterval(timer);
    timer=null;
    activeBar=-1;
    document.querySelectorAll('.bar').forEach(b=>b.classList.remove('active'));

    if (audioContext) {
      const oldContext=audioContext;
      audioContext=null;
      master=null;
      oldContext.close().catch(()=>{});
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
