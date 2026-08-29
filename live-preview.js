(() => {
  const playButton = document.querySelector('#playButton');
  if (!playButton) return;

  const harmonicControls = [
    document.querySelector('#complexity'),
    document.querySelector('#density'),
    document.querySelector('#voiceLeading'),
    document.querySelector('#width')
  ].filter(Boolean);

  const soundControls = [
    document.querySelector('#tempo'),
    ...document.querySelectorAll('[data-drawbar]')
  ].filter(Boolean);

  let lastPreviewAt = 0;
  let trailingTimer = null;
  const minimumGapMs = 85;

  function auditionNow() {
    lastPreviewAt = performance.now();
    playButton.click();
  }

  function scheduleAudition() {
    const elapsed = performance.now() - lastPreviewAt;
    clearTimeout(trailingTimer);

    if (elapsed >= minimumGapMs) {
      auditionNow();
      return;
    }

    trailingTimer = setTimeout(auditionNow, minimumGapMs - elapsed);
  }

  harmonicControls.forEach(control => {
    control.addEventListener('input', () => {
      // app.js rebuilds harmony on `change`; dispatch it while the slider moves
      // so the progression display and the audio always describe the same state.
      control.dispatchEvent(new Event('change', { bubbles: true }));
      scheduleAudition();
    });
  });

  soundControls.forEach(control => {
    control.addEventListener('input', scheduleAudition);
  });

  const key = document.querySelector('#keySelect');
  const form = document.querySelector('#formSelect');
  const leslie = document.querySelector('#leslie');

  [key, form, leslie].filter(Boolean).forEach(control => {
    control.addEventListener('change', scheduleAudition);
  });
})();
