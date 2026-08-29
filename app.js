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
    width: document.querySelector('#width'),
    tempoOutput: document.querySelector('#tempoOutput'),
    complexityOutput: document.querySelector('#complexityOutput'),
    densityOutput: document.querySelector('#densityOutput'),
    voiceLeadingOutput: document.querySelector('#voiceLeadingOutput'),
    widthOutput: document.querySelector('#widthOutput'),
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
  let transportTimer = null;
  let playing = false;
  let activeBar = -1;
  let nextBarIndex = 0;
  let nextBarTime = 0;
  let pendingActiveBar = null;
  let pendingActiveTime = 0;

  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const midiName = midi => `${rootNames[((midi % 12) + 12) % 12]}${Math.floor(midi/12)-1}`;
  const normalizeRoot = n => enharmonic[n] || n;
  const rootForDegree = (key, degree) => rootNames[(pitchClass[key] + degreeSemitones[degree]) % 12];
  const sameVoicing = (a,b) => Boolean(a && b && a.length === b.length && a.every((n,i)=>n===b[i]));
  const pitchClassOf = midi => ((midi % 12) + 12) % 12;
  const secondsPerBar = () => (60 / Number(els.tempo.value)) * 4;

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
    let candidates = Math.random() > richChance ? [baseline] : [...pool];

    if (previousChord && previousChord.root === root && pool.length > 1) {
      const source = candidates.length > 1 ? candidates : pool;
      const varied = source.filter(q => q.name !== previousChord.quality.name);
      if (varied.length) candidates = varied;
    }
    return candidates.length === 1 ? candidates[0] : weightedPick(candidates);
  }

  function closedShape(rootPc, pitchClasses, bassMidi) {
    return pitchClasses.map(pc => {
      let note = bassMidi + ((pc - pitchClassOf(bassMidi)) + 12) % 12;
      if (note < bassMidi) note += 12;
      return note;
    }).sort((a,b)=>a-b);
  }

  function addCandidate(map, notes, family, rootPc) {
    const sorted = [...new Set(notes)].sort((a,b)=>a-b);
    if (sorted.length < 3 || sorted[0] < 40 || sorted[sorted.length-1] > 84) return;
    const key = sorted.join(',');
    if (!map.has(key)) {
      map.set(key, {
        notes: sorted,
        family,
        span: sorted[sorted.length-1] - sorted[0],
        hasRoot: sorted.some(n => pitchClassOf(n) === rootPc)
      });
    }
  }

  function candidateVoicings(rootPc, intervals) {
    const pitchClasses = [...new Set(intervals.map(i => (rootPc + i) % 12))];
    const result = new Map();

    for (let bass = 43; bass <= 60; bass += 1) {
      const closed = closedShape(rootPc, pitchClasses, bass);
      addCandidate(result, closed, 'closed', rootPc);

      if (closed.length >= 4) {
        const drop2 = [...closed];
        drop2[drop2.length - 2] -= 12;
        addCandidate(result, drop2, 'drop-2', rootPc);

        const drop3 = [...closed];
        drop3[drop3.length - 3] -= 12;
        addCandidate(result, drop3, 'drop-3', rootPc);
      }

      addCandidate(result, closed.map((n,i) => i % 2 === 1 ? n + 12 : n), 'open', rootPc);

      if (closed.length >= 4) {
        addCandidate(result, [...closed, closed[closed.length-1] + 12], 'octave top', rootPc);
      }

      const rootless = closed.filter(n => pitchClassOf(n) !== rootPc);
      if (rootless.length >= 3) {
        addCandidate(result, rootless, 'rootless', rootPc);
        addCandidate(result, rootless.map((n,i)=> i === rootless.length-1 ? n + 12 : n), 'rootless open', rootPc);
      }
    }
    return [...result.values()];
  }

  function commonToneCount(a,b) {
    if (!a || !b) return 0;
    const pcsA = new Set(a.map(pitchClassOf));
    return [...new Set(b.map(pitchClassOf))].filter(pc => pcsA.has(pc)).length;
  }

  function voiceDistance(a,b) {
    if (!a) return 0;
    const aa=[...a];
    const bb=[...b];
    while (aa.length < bb.length) aa.push(aa[aa.length-1]+12);
    while (bb.length < aa.length) bb.push(bb[bb.length-1]+12);
    return aa.reduce((sum,n,i)=>sum+Math.abs(n-bb[i]),0);
  }

  function contraryMotionScore(a,b) {
    if (!a || a.length < 2 || b.length < 2) return 0;
    const lowMove = b[0] - a[0];
    const highMove = b[b.length-1] - a[a.length-1];
    if (lowMove === 0 || highMove === 0) return 0;
    return Math.sign(lowMove) !== Math.sign(highMove) ? 1 : 0;
  }

  function chooseVoicing(rootPc, intervals, previous, depth, width) {
    let candidates = candidateVoicings(rootPc, intervals);
    if (previous && candidates.length > 1) {
      const nonRepeating = candidates.filter(c => !sameVoicing(c.notes, previous));
      if (nonRepeating.length) candidates = nonRepeating;
    }

    const targetSpan = 10 + (width / 100) * 24;
    const widthTolerance = 6 + (1 - Math.abs(width - 50) / 50) * 8;
    const widthFiltered = candidates.filter(c => Math.abs(c.span - targetSpan) <= widthTolerance);
    if (widthFiltered.length >= 4) candidates = widthFiltered;

    if (!previous) {
      return [...candidates].sort((a,b)=>{
        const ac = a.notes.reduce((x,y)=>x+y,0)/a.notes.length;
        const bc = b.notes.reduce((x,y)=>x+y,0)/b.notes.length;
        return (Math.abs(a.span-targetSpan) + Math.abs(ac-61)*0.25) -
               (Math.abs(b.span-targetSpan) + Math.abs(bc-61)*0.25);
      })[0];
    }

    const scored = candidates.map(candidate => {
      const notes = candidate.notes;
      const move = voiceDistance(previous,notes);
      const common = commonToneCount(previous,notes);
      const center = notes.reduce((a,b)=>a+b,0)/notes.length;
      const spanError = Math.abs(candidate.span-targetSpan);
      const contrary = contraryMotionScore(previous,notes);
      const hugeJumpPenalty = notes.reduce((penalty,n,i)=>{
        const p = previous[Math.min(i, previous.length-1)];
        return penalty + Math.max(0,Math.abs(n-p)-7);
      },0);

      return {
        ...candidate,
        score:
          move * (0.25 + depth/100) +
          spanError * 0.45 +
          Math.abs(center-61) * 0.14 +
          hugeJumpPenalty * (0.45 + depth/125) -
          common * (1.5 + depth/28) -
          contrary * (depth/18) +
          (candidate.family.startsWith('rootless') ? 0.8 : 0)
      };
    }).sort((a,b)=>a.score-b.score);

    const freedom = Math.floor((100-depth)/22);
    const top = scored.slice(0,Math.max(1,1+freedom));
    return top[Math.floor(Math.random()*top.length)];
  }

  function maybeSubstitute(degree, complexity, density, bar) {
    if (complexity < 68 || density < 45) return degree;
    if (bar === 5 && degree === 4 && Math.random() < density/180) return 'dim';
    return degree;
  }

  function buildProgression(statusText = null) {
    const key = normalizeRoot(els.key.value);
    const form = els.form.value;
    const complexity = Number(els.complexity.value);
    const density = Number(els.density.value);
    const voiceDepth = Number(els.voiceLeading.value);
    const width = Number(els.width.value);

    let previousVoicing = null;
    let previousChord = null;

    progression = forms[form].map((degree, bar) => {
      const substituted = maybeSubstitute(degree,complexity,density,bar);

      if (substituted === 'dim') {
        const root = rootForDegree(key,4);
        const rootPc = (pitchClass[root] + 1) % 12;
        const quality = {name:'dim7', intervals:[0,3,6,9]};
        const picked = chooseVoicing(rootPc,quality.intervals,previousVoicing,voiceDepth,width);
        const chord = {bar,degree:'passing',role:'chromatic',root:rootNames[rootPc],quality,voicing:picked.notes,family:picked.family,span:picked.span};
        previousVoicing = picked.notes;
        previousChord = chord;
        return chord;
      }

      const root = rootForDegree(key,degree);
      const quality = chooseQuality(complexity,density,degree,bar,form,previousChord,root);
      const picked = chooseVoicing(pitchClass[root],quality.intervals,previousVoicing,voiceDepth,width);
      const chord = {bar,degree,role:roleNames[degree],root,quality,voicing:picked.notes,family:picked.family,span:picked.span};
      previousVoicing = picked.notes;
      previousChord = chord;
      return chord;
    });

    els.title.textContent = `12 bars in ${key}`;
    renderProgression();
    if (statusText) els.status.textContent = statusText;
  }

  function renderProgression() {
    els.progression.innerHTML = '';
    progression.forEach((chord,index) => {
      const button = document.createElement('button');
      button.type='button';
      button.className='bar';
      button.dataset.bar=String(index+1);
      button.innerHTML = `<span class="chord-role">${chord.role}</span><span class="chord-name">${chord.root}${chord.quality.name}</span><span class="chord-notes">${chord.voicing.map(midiName).join(' · ')}</span>`;
      if (index === activeBar) button.classList.add('active');
      button.addEventListener('click',()=>selectBar(index));
      els.progression.appendChild(button);
    });
  }

  function selectBar(index) {
    document.querySelectorAll('.bar').forEach((b,i)=>b.classList.toggle('selected',i===index));
    const chord=progression[index];
    els.detailChord.textContent=`Bar ${index+1}: ${chord.root}${chord.quality.name}`;
    els.detailNotes.textContent=`Voicing: ${chord.voicing.map(midiName).join(', ')}. Family: ${chord.family}. Span: ${chord.span} semitones. Role: ${chord.role}.`;
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

  function scheduleBar(index,start,duration) {
    const chord=progression[index];
    chord.voicing.forEach((note,i)=>playOrganNote(note,start+i*.007,duration*.82,1-(i*.04)));
  }

  function setActiveBar(index) {
    activeBar=index;
    document.querySelectorAll('.bar').forEach((b,i)=>b.classList.toggle('active',i===index));
    els.status.textContent=`Playing bar ${index+1} of 12`;
  }

  function transportTick() {
    if (!playing || !audioContext) return;
    const now = audioContext.currentTime;

    if (pendingActiveBar !== null && now >= pendingActiveTime) {
      setActiveBar(pendingActiveBar);
      pendingActiveBar = null;
    }

    if (now >= nextBarTime - 0.06) {
      if (nextBarIndex >= progression.length) {
        stop();
        return;
      }

      const duration = secondsPerBar();
      scheduleBar(nextBarIndex,nextBarTime,duration);
      pendingActiveBar = nextBarIndex;
      pendingActiveTime = nextBarTime;
      nextBarTime += duration;
      nextBarIndex += 1;
    }
  }

  async function play() {
    if (playing) return;
    createAudio();
    if (audioContext.state === 'suspended') await audioContext.resume();

    playing = true;
    nextBarIndex = 0;
    const start = audioContext.currentTime + 0.04;
    const duration = secondsPerBar();
    scheduleBar(0,start,duration);
    nextBarIndex = 1;
    nextBarTime = start + duration;
    pendingActiveBar = 0;
    pendingActiveTime = start;

    transportTimer = setInterval(transportTick,25);
    transportTick();
  }

  function stop(updateStatus=true) {
    playing=false;
    if (transportTimer) clearInterval(transportTimer);
    transportTimer=null;
    activeBar=-1;
    pendingActiveBar=null;
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
    els.widthOutput.value=els.width.value;
  }

  function liveHarmonyUpdate() {
    syncOutputs();
    buildProgression(playing ? 'Updated — next bar uses the new setting.' : 'Updated.');
  }

  [els.complexity,els.density,els.voiceLeading,els.width].forEach(input=>{
    input.addEventListener('input',liveHarmonyUpdate);
  });

  els.tempo.addEventListener('input',()=>{
    syncOutputs();
    if (playing) els.status.textContent='Tempo updated for the next bar.';
  });

  [els.key,els.form].forEach(input=>input.addEventListener('change',()=>{
    buildProgression(playing ? 'Harmony updated for the next bar.' : 'Updated.');
  }));

  document.querySelectorAll('[data-drawbar]').forEach(input=>{
    input.addEventListener('input',()=>{
      if (playing) els.status.textContent='Registration updated for the next bar.';
    });
  });

  els.leslie.addEventListener('change',()=>{
    if (playing) els.status.textContent='Leslie setting updated for the next bar.';
  });

  els.regenerate.addEventListener('click',()=>buildProgression(playing ? 'Regenerated — next bar uses it.' : 'Regenerated.'));
  els.play.addEventListener('click',play);
  els.stop.addEventListener('click',()=>stop());

  syncOutputs();
  buildProgression('Ready.');
})();