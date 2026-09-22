/* =========================================================
   InDeep Demonstrator — web client
   Vanilla JS, no dependencies, no external requests except
   POST /user-speech (same origin).
   ========================================================= */
'use strict';

(function () {

  /* ---------------------------------------------------------
     Config
     --------------------------------------------------------- */

  // The page is served from /ui/, so a relative "user-speech"
  // would resolve to /ui/user-speech. The API lives at the root.
  var API_URL = '/user-speech';

  var RECORD_RATE   = 16000;   // required by the server (16 kHz mono PCM WAV)
  var MIN_RECORD_MS = 300;     // shorter than this is not sent
  var MAX_RECORD_MS = 15000;   // auto-stop after this
  var SILENCE_SEC   = 0.05;    // ~50 ms silent WAV for the intro request
  var OUTPUT_GAIN   = 1.0;

  /* ---------------------------------------------------------
     Copy
     --------------------------------------------------------- */

  var STRINGS = {
    en: {
      subtitle:         'Talk to the computer — it can hear your feeling!',
      welcomeKicker:    'Welcome!',
      welcomeBody:      'Pick a language and I will say hello.',
      choiceNote:       'Tap to start',
      holdToTalk:       'Hold to talk',
      gettingReady:     'Getting ready…',
      listening:        'Listening…',
      thinking:         'Thinking…',
      speaking:         'Speaking…',
      youSaid:          'You said:',
      replay:           '🔁 Hear that again',
      talkAria:         'Hold to talk. Press and hold while you speak, then let go to send.',
      noSpeech:         '(I did not hear any words)',
      tooShort:         'Hold the button while you talk!',
      noAudio:          'I did not hear anything. Try again!',
      recordingProblem: 'I could not use that recording. Please try again.',
      micReady:         'All set! Hold the button while you talk.',
      micBlocked:       'I can\u2019t hear you — the microphone is blocked. Ask the demo person to allow it, then press here to try again.',
      micMissing:       'I can\u2019t find a microphone. Ask the demo person to plug one in, then press here to try again.',
      micBusy:          'Another program is using the microphone. Ask the demo person to close it, then press here to try again.',
      micUnsupported:   'This browser cannot use the microphone. Ask the demo person to open the page in another browser.',
      micInsecure:      'The microphone only works on the demo computer itself. Ask the demo person to open the page on that computer.',
      micGeneric:       'Something went wrong with the microphone. Press here to try again.',
      serverError:      'I can\u2019t reach my brain right now. Ask the demo person to check the big computer.',
      tryAgain:         'Try again',
      errorIcon:        '🎤'
    },
    nl: {
      subtitle:         'Praat tegen de computer — hij hoort hoe je je voelt!',
      welcomeKicker:    'Welkom!',
      welcomeBody:      'Kies een taal en ik zeg hallo.',
      choiceNote:       'Tik om te beginnen',
      holdToTalk:       'Houd ingedrukt',
      gettingReady:     'Even geduld…',
      listening:        'Ik luister…',
      thinking:         'Aan het denken…',
      speaking:         'Aan het praten…',
      youSaid:          'Jij zei:',
      replay:           '🔁 Nog een keer',
      talkAria:         'Houd ingedrukt om te praten. Houd de knop vast tijdens het praten en laat los om te versturen.',
      noSpeech:         '(Ik hoorde geen woorden)',
      tooShort:         'Houd de knop ingedrukt terwijl je praat!',
      noAudio:          'Ik hoorde helemaal niets. Probeer het nog eens!',
      recordingProblem: 'Ik kon die opname niet gebruiken. Probeer het nog eens.',
      micReady:         'Helemaal klaar! Houd de knop ingedrukt terwijl je praat.',
      micBlocked:       'Ik kan je niet horen — de microfoon is geblokkeerd. Vraag de demo-medewerker om hem toe te staan en druk dan hier om het opnieuw te proberen.',
      micMissing:       'Ik kan geen microfoon vinden. Vraag de demo-medewerker om er een aan te sluiten en druk dan hier om het opnieuw te proberen.',
      micBusy:          'Een ander programma gebruikt de microfoon. Vraag de demo-medewerker om het af te sluiten en druk dan hier om het opnieuw te proberen.',
      micUnsupported:   'Deze browser kan de microfoon niet gebruiken. Vraag de demo-medewerker om de pagina in een andere browser te openen.',
      micInsecure:      'De microfoon werkt alleen op de demo-computer zelf. Vraag de demo-medewerker om de pagina daar te openen.',
      micGeneric:       'Er ging iets mis met de microfoon. Druk hier om het opnieuw te proberen.',
      serverError:      'Ik kan mijn brein even niet bereiken. Vraag de demo-medewerker om de grote computer te controleren.',
      tryAgain:         'Opnieuw proberen',
      errorIcon:        '🎤'
    }
  };

  /* ---------------------------------------------------------
     Emotion presentation
     --------------------------------------------------------- */

  var EMOTION_LOOK = {
    neutral:   { emoji: '😐', color: '#6f7683', bg: '#f1f3f6' },
    happy:     { emoji: '😊', color: '#c07d00', bg: '#fff5d9' },
    sad:       { emoji: '😢', color: '#3a6ea8', bg: '#e6f0fb' },
    angry:     { emoji: '😠', color: '#c8322b', bg: '#ffe6e3' },
    fearful:   { emoji: '😨', color: '#6a54b8', bg: '#efeafd' },
    disgusted: { emoji: '🤢', color: '#4a7c2f', bg: '#eaf6df' },
    surprised: { emoji: '😲', color: '#b85f22', bg: '#ffeedd' },
    calm:      { emoji: '😌', color: '#1f7f6f', bg: '#e2f5f1' }
  };

  // Dutch labels map onto the same looks.
  var EMOTION_ALIAS = {
    neutraal: 'neutral', blij: 'happy', verdrietig: 'sad', boos: 'angry',
    bang: 'fearful', walgend: 'disgusted', verbaasd: 'surprised', kalm: 'calm'
  };

  /* ---------------------------------------------------------
     Elements
     --------------------------------------------------------- */

  var screenLanguage = document.getElementById('screenLanguage');
  var screenMain     = document.getElementById('screenMain');
  var statusPill     = document.getElementById('statusPill');
  var statusText     = document.getElementById('statusText');
  var talkWrap       = document.getElementById('talkWrap');
  var talkBtn        = document.getElementById('talkBtn');
  var hint           = document.getElementById('hint');
  var result         = document.getElementById('result');
  var transcriptionText = document.getElementById('transcriptionText');
  var emotionBadge   = document.getElementById('emotionBadge');
  var replayBtn      = document.getElementById('replayBtn');
  var errorCard      = document.getElementById('errorCard');
  var errorIcon      = document.getElementById('errorIcon');
  var errorText      = document.getElementById('errorText');
  var errorRetry     = document.getElementById('errorRetry');

  var langButtons = Array.prototype.slice.call(document.querySelectorAll('[data-lang]'));

  /* ---------------------------------------------------------
     State
     --------------------------------------------------------- */

  var strings      = STRINGS.en;
  var currentLang  = 'en';
  var phase        = 'language';   // language | intro | idle | recording | thinking | speaking
  var lastBlob     = null;         // last response MP3 (for replay)
  var errorRetryFn = null;

  // recording
  var holding       = false;
  var micPending    = false;
  var micStream     = null;
  var mediaRecorder = null;
  var chunks        = [];
  var recordStart   = 0;
  var autoStopTimer = null;

  // metering
  var analyser   = null;
  var meterSource = null;
  var meterBuf   = null;
  var meterRaf   = null;
  var meterLevel = 0;

  // audio playback
  var audioCtx      = null;
  var activeSource  = null;
  var activeAudioEl = null;

  // serialises server requests so we never overlap two demo turns
  var busy = Promise.resolve();

  function enqueue(task) {
    var run = busy.then(task, task);
    busy = run.catch(function () {});
    return run;
  }

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */

  function setPhase(next) {
    phase = next;
    render();
  }

  function render() {
    var s = strings;

    statusPill.className = 'status-pill';
    talkWrap.className   = 'talk-wrap';
    talkBtn.className    = 'talk-btn';

    var label = s.holdToTalk;

    if (phase === 'intro') {
      statusPill.classList.add('is-thinking');
      label = s.gettingReady;
    } else if (phase === 'recording') {
      statusPill.classList.add('is-recording');
      talkWrap.classList.add('is-recording');
      talkBtn.classList.add('is-recording', 'is-pressed');
      label = s.listening;
    } else if (phase === 'thinking') {
      statusPill.classList.add('is-thinking');
      label = s.thinking;
    } else if (phase === 'speaking') {
      statusPill.classList.add('is-speaking');
      talkBtn.classList.add('is-speaking');
      label = s.speaking;
    } else {
      statusPill.classList.add('is-idle');
    }

    if (statusText.textContent !== label) statusText.textContent = label;
  }

  function showHint(text, good) {
    hint.textContent = text || '';
    hint.classList.toggle('is-good', !!good);
  }

  function clearResult() {
    result.hidden = true;
    emotionBadge.hidden = true;
    transcriptionText.textContent = '';
  }

  function restartAnimation(el) {
    el.classList.remove('enter');
    void el.offsetWidth; // force reflow so the animation replays
    el.classList.add('enter');
  }

  function showScreen(name) {
    var main = name === 'main';
    screenLanguage.hidden = main;
    screenMain.hidden = !main;
    if (main) restartAnimation(screenMain);
  }

  function decodeHeaderValue(raw) {
    if (!raw) return '';
    var value = raw;
    // Some servers percent-encode header values to stay ASCII-safe.
    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      try { value = decodeURIComponent(value); } catch (e) { /* keep raw */ }
    }
    // Repair UTF-8 bytes that were read back as latin-1.
    if (/[\u0080-\u00ff]/.test(value)) {
      try {
        var bytes = new Uint8Array(value.length);
        for (var i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
        value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) { /* not mojibake, keep as-is */ }
    }
    return value.trim();
  }

  function applyLanguage(lang) {
    currentLang = lang;
    strings = STRINGS[lang] || STRINGS.en;
    document.documentElement.lang = lang;

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (strings[key] != null) nodes[i].textContent = strings[key];
    }

    var ariaNodes = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < ariaNodes.length; j++) {
      var akey = ariaNodes[j].getAttribute('data-i18n-aria');
      if (strings[akey] != null) ariaNodes[j].setAttribute('aria-label', strings[akey]);
    }

    var loading = lang;
    langButtons.forEach(function (btn) {
      var isCurrent = btn.getAttribute('data-lang') === lang;
      btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
      if (btn.classList.contains('choice')) {
        btn.classList.toggle('is-loading', btn.getAttribute('data-lang') === loading && phase === 'intro');
      }
    });

    errorRetry.textContent = strings.tryAgain;
    render();
  }

  /* ---------------------------------------------------------
     Web Audio plumbing
     --------------------------------------------------------- */

  function getAudioCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended' && audioCtx.resume) {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  // Plays an MP3 blob and resolves when playback has finished.
  function playBlob(blob) {
    stopPlayback();

    var ctx = getAudioCtx();
    if (ctx && ctx.decodeAudioData) {
      return blob.arrayBuffer()
        .then(function (arr) { return ctx.decodeAudioData(arr); })
        .then(function (decoded) {
          return new Promise(function (resolve) {
            var src = ctx.createBufferSource();
            var gain = ctx.createGain();
            gain.gain.value = OUTPUT_GAIN;
            src.buffer = decoded;
            src.connect(gain);
            gain.connect(ctx.destination);
            src.onended = function () {
              if (activeSource === src) activeSource = null;
              resolve();
            };
            activeSource = src;
            src.start(0);
          });
        })
        .catch(function () { return playViaElement(blob); });
    }
    return playViaElement(blob);
  }

  // Fallback for browsers without a usable Web Audio context.
  function playViaElement(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var el = new Audio(url);
      activeAudioEl = el;
      var done = function () {
        URL.revokeObjectURL(url);
        if (activeAudioEl === el) activeAudioEl = null;
        resolve();
      };
      el.onended = done;
      el.onerror = done;
      var attempt = el.play();
      if (attempt && attempt.catch) attempt.catch(done);
    });
  }

  function stopPlayback() {
    if (activeSource) {
      try { activeSource.onended = null; activeSource.stop(0); } catch (e) { /* already done */ }
      activeSource = null;
    }
    if (activeAudioEl) {
      try { activeAudioEl.pause(); } catch (e) { /* ignore */ }
      activeAudioEl = null;
    }
  }

  /* ---------------------------------------------------------
     WAV encoding helpers
     --------------------------------------------------------- */

  function writeAscii(view, offset, text) {
    for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  // Float32 mono samples -> 16-bit PCM WAV blob.
  function encodeWav16(samples, sampleRate) {
    var byteCount = samples.length * 2;
    var buffer = new ArrayBuffer(44 + byteCount);
    var view = new DataView(buffer);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + byteCount, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);              // fmt chunk size
    view.setUint16(20, 1, true);               // PCM
    view.setUint16(22, 1, true);               // mono
    view.setUint32(24, sampleRate, true);      // sample rate
    view.setUint32(28, sampleRate * 2, true);  // byte rate
    view.setUint16(32, 2, true);               // block align
    view.setUint16(34, 16, true);              // bits per sample
    writeAscii(view, 36, 'data');
    view.setUint32(40, byteCount, true);

    var offset = 44;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  // ~50 ms of silence, used for the intro request.
  function makeSilentWav(seconds) {
    var frames = Math.max(1, Math.round(RECORD_RATE * seconds));
    return encodeWav16(new Float32Array(frames), RECORD_RATE);
  }

  // Any recording -> 16 kHz mono 16-bit PCM WAV.
  function blobToWav16k(blob) {
    var ctx = getAudioCtx();
    if (!ctx || !ctx.decodeAudioData) {
      return Promise.reject(new Error('no audio decoding available'));
    }
    return blob.arrayBuffer()
      .then(function (arr) { return ctx.decodeAudioData(arr); })
      .then(function (decoded) {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return Promise.reject(new Error('no offline audio context'));

        var frames = Math.max(1, Math.round(decoded.duration * RECORD_RATE));
        var offline = new OAC(1, frames, RECORD_RATE);
        var src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start(0);

        return offline.startRendering().then(function (rendered) {
          return encodeWav16(rendered.getChannelData(0), RECORD_RATE);
        });
      });
  }

  /* ---------------------------------------------------------
     Server calls
     --------------------------------------------------------- */

  function postSpeech(wavBlob, readIntro, lang) {
    var form = new FormData();
    form.append('user_utterance', wavBlob, 'user_utterance.wav');
    form.append('read_intro', readIntro ? 'true' : 'false');
    form.append('TTS_language', lang);

    return fetch(API_URL, { method: 'POST', body: form, headers: { 'Accept': 'audio/mpeg' } })
      .then(function (response) {
        if (!response.ok) {
          var err = new Error('server responded with ' + response.status);
          err.kind = 'server';
          err.status = response.status;
          throw err;
        }
        return response.blob().then(function (blob) {
          return {
            blob: blob,
            transcription: decodeHeaderValue(response.headers.get('transcription')),
            emotion: decodeHeaderValue(response.headers.get('emotion')),
            score: decodeHeaderValue(response.headers.get('emotion_score'))
          };
        }, function (cause) {
          var readErr = new Error('could not read the response');
          readErr.kind = 'network';
          readErr.cause = cause;
          throw readErr;
        });
      }).catch(function (err) {
        if (err && err.kind) throw err;
        var netErr = new Error('network failure');
        netErr.kind = 'network';
        netErr.cause = err;
        throw netErr;
      });
  }

  // Plays a response while keeping the phase in sync.
  function playResponse(blob) {
    setPhase('speaking');
    return playBlob(blob).then(function () {
      if (phase === 'speaking') setPhase('idle');
    });
  }

  function sendUtterance(wavBlob, readIntro, lang) {
    setPhase('thinking');
    return postSpeech(wavBlob, readIntro, lang).then(function (res) {
      lastBlob = res.blob;
      clearError();
      return playResponse(res.blob).then(function () {
        if (!readIntro) showResult(res);
      });
    }).catch(function (err) {
      if (phase === 'thinking' || phase === 'speaking') setPhase('idle');
      if (err && (err.kind === 'network' || err.kind === 'server')) {
        errorRetryFn = function () {
          clearError();
          enqueue(function () { return sendUtterance(wavBlob, readIntro, lang); });
        };
        showError(strings.serverError, '😵');
      } else {
        showHint(strings.recordingProblem);
      }
    });
  }

  function showResult(res) {
    var text = res.transcription || strings.noSpeech;
    transcriptionText.textContent = '\u201c' + text + '\u201d';
    result.hidden = false;
    updateEmotionBadge(res.emotion, res.score);
  }

  function updateEmotionBadge(emotion, score) {
    if (!emotion) {
      emotionBadge.hidden = true;
      return;
    }
    var key = String(emotion).toLowerCase().trim();
    var canonical = EMOTION_ALIAS[key] || key;
    var look = EMOTION_LOOK[canonical] || { emoji: '🙂', color: '#6f7683', bg: '#f1f3f6' };

    var label = look.emoji + ' ' + key;
    var numeric = parseInt(score, 10);
    if (!isNaN(numeric)) {
      if (numeric < 0) numeric = 0;
      if (numeric > 100) numeric = 100;
      label += ' \u2014 ' + numeric + '%';
    }

    emotionBadge.textContent = label;
    emotionBadge.style.color = look.color;
    emotionBadge.style.background = look.bg;
    emotionBadge.hidden = false;
  }

  /* ---------------------------------------------------------
     Errors
     --------------------------------------------------------- */

  function showError(message, icon) {
    errorText.textContent = message;
    errorIcon.textContent = icon || strings.errorIcon;
    errorCard.hidden = false;
    document.body.classList.add('has-error');
  }

  function clearError() {
    errorCard.hidden = true;
    document.body.classList.remove('has-error');
    errorRetryFn = null;
  }

  function micErrorKind(err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'blocked';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
    return 'generic';
  }

  function showMicError(err) {
    var kind = micErrorKind(err);
    if (!window.isSecureContext) kind = 'insecure';

    var messages = {
      blocked:  strings.micBlocked,
      missing:  strings.micMissing,
      busy:     strings.micBusy,
      insecure: strings.micInsecure,
      generic:  strings.micGeneric
    };

    errorRetryFn = function () {
      clearError();
      primeMicrophone();
    };
    showError(messages[kind] || strings.micGeneric, '🎤');
  }

  function primeMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError(strings.micUnsupported, '🚫');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
      clearError();
      showHint(strings.micReady, true);
    }).catch(function (err) {
      showMicError(err);
    });
  }

  /* ---------------------------------------------------------
     Recording
     --------------------------------------------------------- */

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    var options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < options.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(options[i])) return options[i];
    }
    return '';
  }

  function releaseMic() {
    stopMeter();
    if (micStream) {
      micStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
      micStream = null;
    }
    mediaRecorder = null;
  }

  function beginRecording() {
    if (typeof MediaRecorder === 'undefined') {
      showError(strings.micUnsupported, '🚫');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError(window.isSecureContext ? strings.micUnsupported : strings.micInsecure, '🚫');
      return;
    }

    micPending = true;

    navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    }).then(function (stream) {
      micPending = false;
      if (!holding) {
        // The child let go while the permission prompt was open.
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
        return;
      }
      startRecorder(stream);
    }).catch(function (err) {
      micPending = false;
      holding = false;
      setPhase('idle');
      showMicError(err);
    });
  }

  function startRecorder(stream) {
    micStream = stream;
    startMeter(stream);
    chunks = [];

    var recorder;
    try {
      var mime = pickMimeType();
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      releaseMic();
      setPhase('idle');
      showMicError(e);
      return;
    }

    mediaRecorder = recorder;

    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onerror = function () {
      releaseMic();
      setPhase('idle');
      showHint(strings.recordingProblem);
    };

    try {
      recorder.start();
    } catch (e) {
      releaseMic();
      setPhase('idle');
      showHint(strings.recordingProblem);
      return;
    }

    recordStart = now();
    setPhase('recording');

    autoStopTimer = window.setTimeout(function () {
      if (phase === 'recording') stopRecording();
    }, MAX_RECORD_MS);
  }

  function stopRecording() {
    if (phase !== 'recording') return;

    if (autoStopTimer) { window.clearTimeout(autoStopTimer); autoStopTimer = null; }
    stopMeter();

    var recorder = mediaRecorder;
    var elapsed = now() - recordStart;
    var tooShort = elapsed < MIN_RECORD_MS;

    if (!recorder) {
      holding = false;
      setPhase('idle');
      return;
    }

    if (tooShort) {
      recorder.onstop = function () {
        releaseMic();
        setPhase('idle');
        showHint(strings.tooShort);
      };
    } else {
      setPhase('thinking');
      recorder.onstop = function () {
        releaseMic();
        var recorded = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!recorded.size) {
          setPhase('idle');
          showHint(strings.noAudio);
          return;
        }
        blobToWav16k(recorded).then(function (wav) {
          return enqueue(function () { return sendUtterance(wav, false, currentLang); });
        }).catch(function () {
          if (phase === 'thinking') setPhase('idle');
          showHint(strings.recordingProblem);
        });
      };
    }

    try {
      recorder.stop();
    } catch (e) {
      releaseMic();
      setPhase('idle');
      showHint(strings.recordingProblem);
    }
  }

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  /* ---------------------------------------------------------
     Live level meter
     --------------------------------------------------------- */

  function startMeter(stream) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      meterSource = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      meterSource.connect(analyser);   // deliberately not connected to the speakers
      meterBuf = new Uint8Array(analyser.fftSize);
      meterLevel = 0;
      meterRaf = window.requestAnimationFrame(tickMeter);
    } catch (e) {
      analyser = null;
    }
  }

  function tickMeter() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(meterBuf);

    var sum = 0;
    for (var i = 0; i < meterBuf.length; i++) {
      var v = (meterBuf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / meterBuf.length);
    var target = Math.min(1, rms * 3.2);
    meterLevel = Math.max(target, meterLevel * 0.86);

    talkWrap.style.setProperty('--level', meterLevel.toFixed(3));
    meterRaf = window.requestAnimationFrame(tickMeter);
  }

  function stopMeter() {
    if (meterRaf) { window.cancelAnimationFrame(meterRaf); meterRaf = null; }
    if (meterSource) {
      try { meterSource.disconnect(); } catch (e) { /* ignore */ }
      meterSource = null;
    }
    analyser = null;
    meterLevel = 0;
    talkWrap.style.setProperty('--level', '0');
  }

  /* ---------------------------------------------------------
     Talk button: press and hold
     --------------------------------------------------------- */

  function canRecord() {
    return phase === 'idle' || phase === 'speaking';
  }

  function onPressStart(event) {
    if (event) event.preventDefault();
    getAudioCtx();               // unlock audio during the user gesture
    if (!canRecord()) return;
    if (holding || micPending) return;

    holding = true;
    stopPlayback();
    clearError();
    showHint('');
    if (talkBtn.setPointerCapture && event && event.pointerId != null) {
      try { talkBtn.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    }
    beginRecording();
  }

  function onPressEnd() {
    if (!holding && !micPending) return;
    holding = false;
    if (phase === 'recording') stopRecording();
  }

  talkBtn.addEventListener('pointerdown', onPressStart);
  talkBtn.addEventListener('pointerup', onPressEnd);
  talkBtn.addEventListener('pointercancel', onPressEnd);
  talkBtn.addEventListener('lostpointercapture', function () {
    if (phase === 'recording') onPressEnd();
  });

  // Holding must not scroll the page or open a context menu.
  talkBtn.addEventListener('touchmove', function (event) {
    if (phase === 'recording' || holding) event.preventDefault();
  }, { passive: false });

  talkBtn.addEventListener('contextmenu', function (event) { event.preventDefault(); });

  // Keyboard equivalent (space / enter held down).
  talkBtn.addEventListener('keydown', function (event) {
    if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat) return;
    onPressStart(null);
  });
  talkBtn.addEventListener('keyup', function (event) {
    if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'Enter') return;
    event.preventDefault();
    onPressEnd();
  });
  talkBtn.addEventListener('blur', function () { onPressEnd(); });

  /* ---------------------------------------------------------
     Language selection + intro
     --------------------------------------------------------- */

  function selectLanguage(lang) {
    getAudioCtx();               // unlock audio during the user gesture
    stopPlayback();
    clearError();
    applyLanguage(lang);
    showScreen('main');

    setPhase('intro');
    var choices = document.querySelectorAll('.choice');
    for (var i = 0; i < choices.length; i++) choices[i].classList.add('is-loading');

    enqueue(function () {
      return postSpeech(makeSilentWav(SILENCE_SEC), true, lang).then(function (res) {
        lastBlob = res.blob;
        return playResponse(res.blob);
      });
    }).catch(function (err) {
      if (phase === 'intro') setPhase('idle');
      if (err && (err.kind === 'network' || err.kind === 'server')) {
        errorRetryFn = function () { clearError(); selectLanguage(lang); };
        showError(strings.serverError, '😵');
      }
    }).then(function () {
      for (var i = 0; i < choices.length; i++) choices[i].classList.remove('is-loading');
      if (phase === 'intro') setPhase('idle');
    });
  }

  langButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectLanguage(btn.getAttribute('data-lang'));
    });
  });

  /* ---------------------------------------------------------
     Replay
     --------------------------------------------------------- */

  replayBtn.addEventListener('click', function () {
    if (!lastBlob) return;
    if (phase === 'recording' || micPending) return;
    getAudioCtx();
    clearError();
    enqueue(function () { return playResponse(lastBlob); }).catch(function () {
      if (phase === 'speaking') setPhase('idle');
    });
  });

  /* ---------------------------------------------------------
     Error retry
     --------------------------------------------------------- */

  errorRetry.addEventListener('click', function () {
    if (typeof errorRetryFn === 'function') {
      errorRetryFn();
    } else {
      clearError();
    }
  });

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */

  window.addEventListener('beforeunload', function () {
    stopPlayback();
    releaseMic();
  });

  applyLanguage('en');
  showScreen('language');
  clearResult();
  showHint('');

})();
