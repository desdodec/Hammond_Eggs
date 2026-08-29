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

  const key = document.querySelector('#keySelect');
  const form = document.querySelector('#formSelect');
  const leslie = document.querySelector('#leslie');

  let lastPreviewAt = -Infinity;
  const minimumGapMs = 90;

  function regenerateAndPlay(control) {
    // Mark this change so our capture listener lets it reach app.js.
    const event = new Event('change', { bubbles: true });
    event.hammondLivePreview = true;
    control.dispatchEvent(event);

    // Keep this synchronous with the real pointer/keyboard gesture. Delaying it
    // with setTimeout can lose browser Web Audio user-activation permission.
    playButton.click();
    lastPreviewAt = performance.now();
  }

  harmonicControls.forEach(control => {
    // app.js has a normal `change` listener which regenerates by stopping audio.
    // Suppress the browser's later native change event; live-preview owns it.
    control.addEventListener('change', event => {
      if (!event.hammondLivePreview) {
        event.stopImmediatePropagation();
        regenerateAndPlay(control);
      }
    }, true);

    control.addEventListener('input', () => {
      const now = performance.now();
      if (now - lastPreviewAt >= minimumGapMs) {
        regenerateAndPlay(control);
      }
    });
  });

  soundControls.forEach(control => {
    control.addEventListener('input', () => {
      const now = performance.now();
      if (now - lastPreviewAt >= minimumGapMs) {
        playButton.click();
        lastPreviewAt = now;
      }
    });
  });

  [key, form, leslie].filter(Boolean).forEach(control => {
    control.addEventListener('change', () => {
      playButton.click();
      lastPreviewAt = performance.now();
    });
  });
})();
