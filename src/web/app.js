/* =========================================================
   InDeep Demonstrator — reliability-focused web client (v2)

   Goals over the first version:
   - never leave the UI stuck in "thinking" (request timeouts + retry)
   - never let two turns overwrite each other (client turn ids; the server
     also queues requests and gives each one its own response object)
   - show the transcription/emotion as soon as the response arrives, before
     playback finishes
   - make microphone and recording failures explicit and recoverable
   - add connection status, recording timer, stop-playback, keyboard support,
     and reduced-motion accessibility.
   ========================================================= */
'use strict';

(function () {

  /* ---------------------------------------------------------
     Config
     --------------------------------------------------------- */

  var API_URL = '/user-speech';
  var HEALTH_URL = '/health';

  var REQUEST_TIMEOUT_MS = 180000;  // 3 min: generous for Whisper large models
  var HEALTH_TIMEOUT_MS = 5000;
  var HEALTH_INTERVAL_MS = 15000;

  var RECORD_RATE = 16000;          // server expects 16 kHz mono PCM WAV
  var MIN_RECORD_MS = 350;
  var MAX_RECORD_MS = 20000;
  var SILENCE_SEC = 0.05;           // silent request that triggers the intro
  var OUTPUT_GAIN = 1.0;

  /* ---------------------------------------------------------
     Copy
     --------------------------------------------------------- */

  var STRINGS = {
    en: {
      subtitle:          'Talk to the computer — it can hear your feeling!',
      welcomeKicker:     'Welcome!',
      welcomeBody:       'Pick a language and I will say hello.',
      choiceNote:        'Tap to start',
      holdToTalk:        'Hold to talk',
      gettingReady:      'Getting ready…',
      listening:         'Listening…',
      thinking:          'Thinking…',
      speaking:          'Speaking…',
      youSaid:           'You said:',
      replay:            '🔁 Hear that again',
      stopPlayback:      '⏹ Stop',
      keyboardHint:      'Tip: hold Space or Enter to talk.',
      talkAria:          'Hold to talk. Press and hold while you speak, then let go to send.',
      noSpeech:          '(I did not hear any words)',
      tooShort:          'Hold the button while you talk!',
      noAudio:           'I did not hear anything. Try again!',
      recordingProblem:  'I could not use that recording. Please try again.',
      micReady:          'All set! Hold the button while you talk.',
      micBlocked:        'I can’t hear you — the microphone is blocked. Ask the demo person to allow it, then press here to try again.',
      micMissing:        'I can’t find a microphone. Ask the demo person to plug one in, then press here to try again.',
      micBusy:           'Another program is using the microphone. Ask the demo person to close it, then press here to try again.',
      micUnsupported:    'This browser cannot use the microphone. Ask the demo person to open the page in another browser.',
      micInsecure:       'The microphone only works on the demo computer itself. Ask the demo person to open the page on that computer.',
      micGeneric:        'Something went wrong with the microphone. Press here to try again.',
      serverError:       'I can’t reach my brain right now. Ask the demo person to check the big computer.',
      serverTimeout:     'The big computer is taking a long time. Check that the server is running, then try again.',
      serverOffline:     'The demo server is offline. Check the big computer or the SSH tunnel.',
      serverOnline:      'Demo server connected',
      serverConnecting:  'Connecting…',
      tryAgain:          'Try again',
      errorIcon:         '🎤'
    },
    nl: {
      subtitle:          'Praat tegen de computer — hij hoort hoe je je voelt!',
      welcomeKicker:     'Welkom!',
      welcomeBody:       'Kies een taal en ik zeg hallo.',
      choiceNote:        'Tik om te beginnen',
      holdToTalk:        'Houd ingedrukt',
      gettingReady:      'Even geduld…',
      listening:         'Ik luister…',
      thinking:          'Aan het denken…',
      speaking:          'Aan het praten…',
      youSaid:           'Jij zei:',
      replay:            '🔁 Nog een keer',
      stopPlayback:      '⏹ Stop',
      keyboardHint:      'Tip: houd de spatiebalk of Enter ingedrukt om te praten.',
      talkAria:          'Houd ingedrukt om te praten. Houd de knop vast tijdens het praten en laat los om te versturen.',
      noSpeech:          '(Ik hoorde geen woorden)',
      tooShort:          'Houd de knop ingedrukt terwijl je praat!',
      noAudio:           'Ik hoorde helemaal niets. Probeer het het nog eens!',
      recordingProblem:  'Ik kon die opname niet gebruiken. Probeer het nog eens.',
      micReady:          'Helemaal klaar! Houd de knop ingedrukt terwijl je praat.',
      micBlocked:        'Ik kan je niet horen — de microfoon is geblokkeerd. Vraag de demo-medewerker om hem toe te staan en druk dan hier om het opnieuw te proberen.',
      micMissing:        'Ik kan geen microfoon vinden. Vraag de demo-medewerker om er een aan te sluiten en druk dan hier om het opnieuw te proberen.',
      micBusy:           'Een ander programma gebruikt de microfoon. Vraag de demo-medewerker om het af te sluiten en druk dan hier om het opnieuw te proberen.',
      micUnsupported:    'Deze browser kan de microfoon niet gebruiken. Vraag de demo-medewerker om de pagina in een andere browser te openen.',
      micInsecure:       'De microfoon werkt alleen op de demo-computer zelf. Vraag de demo-medewerker om de pagina daar te openen.',
      micGeneric:        'Er ging iets mis met de microfoon. Druk hier om het opnieuw te proberen.',
      serverError:       'Ik kan mijn brein even niet bereiken. Vraag de demo-medewerker om de grote computer te controleren.',
      serverTimeout:     'De grote computer doet er lang over. Controleer of de server draait en probeer het opnieuw.',
      serverOffline:     'De demo-server is offline. Controleer de grote computer of de SSH-tunnel.',
      serverOnline:      'Demo-server verbonden',
      serverConnecting:  'Verbinden…',
      tryAgain:          'Opnieuw proberen',
      errorIcon:         '🎤'
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

  var EMOTION_ALIAS = {
    neutraal: 'neutral', blij: 'happy', verdrietig: 'sad', boos: 'angry',
    bang: 'fearful', walgend: 'disgusted', verbaasd: 'surprised', kalm: 'calm'
  };

  /* ---------------------------------------------------------
     Elements
     --------------------------------------------------------- */

  var screenLanguage      = document.getElementById('screenLanguage');
  var screenMain          = document.getElementById('screenMain');
  var statusPill          = document.getElementById('statusPill');
  var statusText          = document.getElementById('statusText');
  var talkWrap            = document.getElementById('talkWrap');
  var talkBtn             = document.getElementById('talkBtn');
  var talkLabel           = document.getElementById('talkLabel');
  var hint                = document.getElementById('hint');
  var keyboardHint        = document.getElementById('keyboardHint');
  var recordTimer         = document.getElementById('recordTimer');
  var result              = document.getElementById('result');
  var transcriptionText   = document.getElementById('transcriptionText');
  var emotionBadge        = document.getElementById('emotionBadge');
  var replayBtn           = document.getElementById('replayBtn');
  var stopPlaybackBtn     = document.getElementById('stopPlaybackBtn');
  var errorCard           = document.getElementById('errorCard');
  var errorIcon           = document.getElementById('errorIcon');
  var errorText           = document.getElementById('errorText');
  var errorRetry          = document.getElementById('errorRetry');
  var serverStatus        = document.getElementById('serverStatus');
  var serverStatusText    = document.getElementById('serverStatusText');

  var langButtons = Array.prototype.slice.call(document.querySelectorAll('[data-lang]'));
  var choiceButtons = Array.prototype.slice.call(document.querySelectorAll('.choice'));

  /* ---------------------------------------------------------
     State
     --------------------------------------------------------- */

  var phase = 'language';        // language | intro | idle | recording | thinking | speaking
  var currentLang = 'nl';
  var strings = STRINGS.en;
  var lastBlob = null;
  var lastResult = null;
  var lastAction = null;         // action to retry after an error

  var turnCounter = 0;
  var activeController = null;

  var audioCtx = null;
  var activePlayback = null;
  var activeAudioEl = null;

  var micStream = null;
  var mediaRecorder = null;
  var chunks = [];
  var recordStart = 0;
  var autoStopTimer = null;
  var recordTimerInterval = null;
  var holding = false;
  var micPending = false;

  var meterSource = null;
  var analyser = null;
  var meterBuf = null;
  var meterRaf = null;
  var meterLevel = 0;

  var healthTimer = null;
  var wakeLock = null;
  var serverState = 'unknown';

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */

  function setPhase(next) {
    phase = next;
    render();
  }

  function canRecord() {
    return phase === 'idle' || phase === 'speaking';
  }

  function render() {
    var s = strings;
    var label = s.holdToTalk;

    statusPill.className = 'status-pill';
    talkWrap.className = 'talk-wrap';
    talkBtn.className = 'talk-btn';

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
    if (talkLabel.textContent !== label) talkLabel.textContent = label;

    var available = canRecord() && !micPending;
    talkBtn.setAttribute('aria-disabled', available ? 'false' : 'true');

    recordTimer.hidden = phase !== 'recording';
    stopPlaybackBtn.hidden = phase !== 'speaking' || !lastBlob;
    replayBtn.disabled = !lastBlob || phase === 'recording' || phase === 'thinking' || phase === 'intro';

    langButtons.forEach(function (btn) {
      btn.disabled = phase === 'intro';
    });

    if (phase === 'idle' && serverStatus.classList.contains('is-offline')) {
      showHint(s.serverOffline);
    }
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
    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      try { value = decodeURIComponent(value); } catch (e) { /* keep raw */ }
    }
    // Repair UTF-8 bytes that were read back as latin-1 by an older server.
    if (/[\u0080-\u00ff]/.test(value)) {
      try {
        var bytes = new Uint8Array(value.length);
        for (var i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
        value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) { /* not mojibake, keep as-is */ }
    }
    return value.trim();
  }

  function formatMs(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
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

    langButtons.forEach(function (btn) {
      var isCurrent = btn.getAttribute('data-lang') === lang;
      btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
    });

    errorRetry.textContent = strings.tryAgain;
    setServerStatus(serverState);
    render();
  }

  /* ---------------------------------------------------------
     Turn / request bookkeeping
     --------------------------------------------------------- */

  function beginTurn() {
    turnCounter += 1;
    if (activeController) {
      try { activeController.abort(); } catch (e) { /* ignore */ }
    }
    activeController = new AbortController();
    return { id: turnCounter, controller: activeController };
  }

  function isCurrent(token) {
    return !!(token && token.id === turnCounter);
  }

  function finishTurn(token) {
    if (isCurrent(token)) activeController = null;
  }

  function cancelTurn() {
    turnCounter += 1;
    if (activeController) {
      try { activeController.abort(); } catch (e) { /* ignore */ }
    }
    activeController = null;
  }

  /* ---------------------------------------------------------
     Network helpers
     --------------------------------------------------------- */

  function makeTimeoutError() {
    var err = new Error('Request timed out');
    err.kind = 'timeout';
    return err;
  }

  function fetchWithTimeout(url, options, timeoutMs, token) {
    options = options || {};
    var controller = (token && token.controller) || new AbortController();
    var timedOut = false;

    var timer = window.setTimeout(function () {
      timedOut = true;
      try { controller.abort(); } catch (e) { /* ignore */ }
    }, timeoutMs);

    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then(function (response) {
        window.clearTimeout(timer);
        return response;
      })
      .catch(function (err) {
        window.clearTimeout(timer);
        if (timedOut) throw makeTimeoutError();
        if (err && err.name === 'AbortError') {
          var aborted = new Error('Request was cancelled');
          aborted.kind = 'aborted';
          throw aborted;
        }
        var network = new Error('Network failure');
        network.kind = 'network';
        network.cause = err;
        throw network;
      });
  }

  function postSpeech(wavBlob, readIntro, lang, token) {
    var form = new FormData();
    form.append('user_utterance', wavBlob, 'user_utterance.wav');
    form.append('read_intro', readIntro ? 'true' : 'false');
    form.append('TTS_language', lang);

    return fetchWithTimeout(
      API_URL,
      {
        method: 'POST',
        body: form,
        headers: { 'Accept': 'audio/mpeg' },
        cache: 'no-store'
      },
      REQUEST_TIMEOUT_MS,
      token
    ).then(function (response) {
      if (!response.ok) {
        var err = new Error('Server responded with ' + response.status);
        err.kind = response.status === 504 ? 'timeout' : 'server';
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
        var readErr = new Error('Could not read the server response');
        readErr.kind = 'network';
        readErr.cause = cause;
        throw readErr;
      });
    });
  }

  function checkHealth(silent) {
    if (!silent) setServerStatus('checking');

    var token = { id: -1, controller: new AbortController() };
    return fetchWithTimeout(HEALTH_URL, { method: 'GET', cache: 'no-store' }, HEALTH_TIMEOUT_MS, token)
      .then(function (response) {
        if (response.status === 404) {
          // Backend without a /health endpoint (e.g. the unmodified upstream
          // server): a reply means it is reachable, so assume online and stop
          // polling.
          if (healthTimer) { window.clearInterval(healthTimer); healthTimer = null; }
          if (!silent) setServerStatus('online');
          return true;
        }
        if (!response.ok) throw new Error('Health endpoint returned ' + response.status);
        setServerStatus('online');
        return true;
      })
      .catch(function () {
        setServerStatus('offline');
        return false;
      });
  }

  function setServerStatus(state) {
    serverState = state;
    serverStatus.className = 'server-status is-' + state;
    if (state === 'online') serverStatusText.textContent = strings.serverOnline;
    else if (state === 'offline') serverStatusText.textContent = strings.serverOffline;
    else serverStatusText.textContent = strings.serverConnecting;

    if (state === 'offline' && phase === 'idle') showHint(strings.serverOffline);
  }

  /* ---------------------------------------------------------
     Audio playback
     --------------------------------------------------------- */

  function getAudioCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended' && audioCtx.resume) {
      try { audioCtx.resume(); } catch (e) { /* ignore */ }
    }
    return audioCtx;
  }

  function unlockAudio() {
    var ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().catch(function () { /* ignore */ });
    }
  }

  function decodeAudio(ctx, blob) {
    return blob.arrayBuffer().then(function (arrayBuffer) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        function ok(decoded) { if (settled) return; settled = true; resolve(decoded); }
        function fail(err) { if (settled) return; settled = true; reject(err); }

        var maybe;
        try {
          maybe = ctx.decodeAudioData(arrayBuffer, ok, fail);
        } catch (e) {
          fail(e);
          return;
        }
        if (maybe && typeof maybe.then === 'function') maybe.then(ok, fail);
      });
    });
  }

  function playElement(blob, playback, finish) {
    var url = URL.createObjectURL(blob);
    var el = new Audio(url);
    activeAudioEl = el;

    function cleanup() {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      if (activeAudioEl === el) activeAudioEl = null;
    }

    el.onended = function () { cleanup(); finish(null); };
    el.onerror = function () { cleanup(); finish(new Error('Audio playback failed')); };

    playback.stop = function () {
      try { el.pause(); } catch (e) { /* ignore */ }
      cleanup();
      finish(null);
    };

    var attempt = el.play();
    if (attempt && attempt.catch) {
      attempt.catch(function (err) { cleanup(); finish(err); });
    }
  }

  function playBlob(blob) {
    stopPlayback();

    return new Promise(function (resolve, reject) {
      var settled = false;
      var playback = {
        stop: function () { finish(null); }
      };

      function finish(err) {
        if (settled) return;
        settled = true;
        if (activePlayback === playback) activePlayback = null;
        if (err) reject(err); else resolve();
      }

      activePlayback = playback;

      var ctx = getAudioCtx();
      if (ctx && ctx.decodeAudioData) {
        decodeAudio(ctx, blob).then(function (decoded) {
          if (activePlayback !== playback) return;

          var src = ctx.createBufferSource();
          var gain = ctx.createGain();
          gain.gain.value = OUTPUT_GAIN;
          src.buffer = decoded;
          src.connect(gain);
          gain.connect(ctx.destination);
          src.onended = function () { finish(null); };

          playback.stop = function () {
            try {
              src.onended = null;
              src.stop(0);
            } catch (e) { /* already stopped */ }
            finish(null);
          };

          try {
            src.start(0);
          } catch (e) {
            finish(e);
          }
        }).catch(function () {
          if (activePlayback !== playback) return;
          playElement(blob, playback, finish);
        });
      } else {
        playElement(blob, playback, finish);
      }
    });
  }

  function stopPlayback() {
    if (activePlayback) {
      var playback = activePlayback;
      activePlayback = null;
      try { playback.stop(); } catch (e) { /* ignore */ }
    }
    if (activeAudioEl) {
      try { activeAudioEl.pause(); } catch (e) { /* ignore */ }
      activeAudioEl = null;
    }
  }

  function playResponse(blob, token) {
    if (!isCurrent(token)) return Promise.resolve();
    setPhase('speaking');
    return playBlob(blob).then(function () {
      if (isCurrent(token) && phase === 'speaking') setPhase('idle');
    }, function (err) {
      if (isCurrent(token) && phase === 'speaking') setPhase('idle');
      throw err;
    });
  }

  /* ---------------------------------------------------------
     WAV encoding helpers
     --------------------------------------------------------- */

  function writeAscii(view, offset, text) {
    for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function encodeWav16(samples, sampleRate) {
    var byteCount = samples.length * 2;
    var buffer = new ArrayBuffer(44 + byteCount);
    var view = new DataView(buffer);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + byteCount, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
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

  function makeSilentWav(seconds) {
    var frames = Math.max(1, Math.round(RECORD_RATE * seconds));
    return encodeWav16(new Float32Array(frames), RECORD_RATE);
  }

  function blobToWav16k(blob) {
    var ctx = getAudioCtx();
    if (!ctx || !ctx.decodeAudioData) {
      return Promise.reject(new Error('Audio decoding is unavailable'));
    }

    return decodeAudio(ctx, blob).then(function (decoded) {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) throw new Error('Offline audio processing is unavailable');

      if (!isFinite(decoded.duration) || decoded.duration <= 0) {
        throw new Error('Empty recording');
      }

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
     Status / errors
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

  var errorRetryFn = null;

  function showMicError(err) {
    var name = (err && err.name) || '';
    var kind = 'generic';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') kind = 'blocked';
    else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') kind = 'missing';
    else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') kind = 'busy';

    if (!window.isSecureContext) kind = 'insecure';

    var messages = {
      blocked: strings.micBlocked,
      missing: strings.micMissing,
      busy: strings.micBusy,
      insecure: strings.micInsecure,
      generic: strings.micGeneric
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
      stream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (e) { /* ignore */ }
      });
      clearError();
      showHint(strings.micReady, true);
    }).catch(function (err) {
      showMicError(err);
    });
  }

  function showResult(res) {
    var text = res.transcription || strings.noSpeech;
    transcriptionText.textContent = '\u201c' + text + '\u201d';
    result.hidden = false;
    updateEmotionBadge(res.emotion, res.score);
    render();
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

  function handleActionError(err, fallbackMessage) {
    if (!err || err.kind === 'aborted') return;

    if (phase === 'intro' || phase === 'thinking' || phase === 'speaking') {
      setPhase('idle');
    }

    checkHealth(true);

    var message = fallbackMessage || strings.serverError;
    var icon = '😵';
    if (err.kind === 'timeout') {
      message = strings.serverTimeout;
      icon = '⏱';
    } else if (err.kind === 'network') {
      message = strings.serverError;
    }

    errorRetryFn = function () {
      clearError();
      retryLastAction();
    };
    showError(message, icon);
  }

  function retryLastAction() {
    var action = lastAction;
    if (!action) {
      showHint(strings.recordingProblem);
      return;
    }
    clearError();
    if (action.kind === 'intro') {
      startIntro(action.lang);
    } else if (action.kind === 'speech') {
      sendUtterance(action.wav);
    }
  }

  /* ---------------------------------------------------------
     Server turns: intro, speech, retry, replay
     --------------------------------------------------------- */

  function startIntro(lang) {
    unlockAudio();
    cancelTurn();
    stopPlayback();
    clearError();
    clearResult();
    lastBlob = null;
    lastResult = null;
    lastAction = { kind: 'intro', lang: lang };

    applyLanguage(lang);
    showScreen('main');
    setPhase('intro');

    choiceButtons.forEach(function (btn) { btn.classList.add('is-loading'); });

    var token = beginTurn();

    postSpeech(makeSilentWav(SILENCE_SEC), true, lang, token)
      .then(function (res) {
        if (!isCurrent(token)) return null;
        setServerStatus('online');
        lastBlob = res.blob;
        clearError();
        return playResponse(res.blob, token);
      })
      .catch(function (err) {
        if (!isCurrent(token) || (err && err.kind === 'aborted')) return;
        setServerStatus('offline');
        handleActionError(err, strings.serverError);
      })
      .then(function () {
        choiceButtons.forEach(function (btn) { btn.classList.remove('is-loading'); });
        if (isCurrent(token)) {
          finishTurn(token);
          if (phase === 'intro') setPhase('idle');
        }
      });
  }

  function sendUtterance(wavBlob) {
    cancelTurn();
    stopPlayback();
    clearError();
    clearResult();

    lastAction = { kind: 'speech', wav: wavBlob, lang: currentLang };
    setPhase('thinking');

    var token = beginTurn();

    postSpeech(wavBlob, false, currentLang, token)
      .then(function (res) {
        if (!isCurrent(token)) return null;
        setServerStatus('online');
        lastBlob = res.blob;
        lastResult = res;
        showResult(res);                 // show feedback before playback
        return playResponse(res.blob, token);
      })
      .catch(function (err) {
        if (!isCurrent(token) || (err && err.kind === 'aborted')) return;
        setServerStatus('offline');
        handleActionError(err, strings.serverError);
      })
      .then(function () {
        if (isCurrent(token)) finishTurn(token);
      });
  }

  function replayLastResponse() {
    if (!lastBlob) return;
    if (phase === 'recording' || phase === 'thinking' || phase === 'intro' || micPending) return;

    unlockAudio();
    clearError();
    stopPlayback();

    var token = beginTurn();
    playResponse(lastBlob, token)
      .catch(function () {
        if (isCurrent(token) && phase === 'speaking') setPhase('idle');
      })
      .then(function () {
        if (isCurrent(token)) finishTurn(token);
      });
  }

  /* ---------------------------------------------------------
     Recording and microphone
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
    if (mediaRecorder) {
      try {
        if (mediaRecorder.state && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      } catch (e) { /* ignore */ }
      mediaRecorder = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (e) { /* ignore */ }
      });
      micStream = null;
    }
  }

  function updateRecordTimer() {
    if (phase !== 'recording') return;
    var elapsed = now() - recordStart;
    recordTimer.textContent = formatMs(elapsed) + ' / ' + formatMs(MAX_RECORD_MS);
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
    recordTimer.textContent = '0:00 / ' + formatMs(MAX_RECORD_MS);
    setPhase('recording');

    if (recordTimerInterval) window.clearInterval(recordTimerInterval);
    recordTimerInterval = window.setInterval(updateRecordTimer, 200);

    if (autoStopTimer) window.clearTimeout(autoStopTimer);
    autoStopTimer = window.setTimeout(function () {
      if (phase === 'recording') stopRecording();
    }, MAX_RECORD_MS);
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
    render();

    navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
      micPending = false;
      if (!holding) {
        stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (e) { /* ignore */ }
        });
        setPhase('idle');
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

  function stopRecording() {
    if (phase !== 'recording') return;

    if (autoStopTimer) { window.clearTimeout(autoStopTimer); autoStopTimer = null; }
    if (recordTimerInterval) { window.clearInterval(recordTimerInterval); recordTimerInterval = null; }
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
          if (phase !== 'thinking') return;
          sendUtterance(wav);
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
      meterSource.connect(analyser);   // do not route mic audio to speakers
      meterBuf = new Uint8Array(analyser.fftSize);
      meterLevel = 0;
      meterRaf = window.requestAnimationFrame(tickMeter);
    } catch (e) {
      analyser = null;
    }
  }

  function tickMeter() {
    if (!analyser || !meterBuf) return;
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
    meterBuf = null;
    meterLevel = 0;
    talkWrap.style.setProperty('--level', '0');
  }

  /* ---------------------------------------------------------
     Press-and-hold interaction
     --------------------------------------------------------- */

  function onPressStart(event) {
    if (event && event.preventDefault) event.preventDefault();
    unlockAudio();

    if (!canRecord() || holding || micPending) return;

    holding = true;
    stopPlayback();
    clearError();
    clearResult();
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

  talkBtn.addEventListener('touchmove', function (event) {
    if (phase === 'recording' || holding) event.preventDefault();
  }, { passive: false });

  talkBtn.addEventListener('contextmenu', function (event) { event.preventDefault(); });

  talkBtn.addEventListener('keydown', function (event) {
    if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'Enter') return;
    if (event.repeat) { event.preventDefault(); return; }
    event.preventDefault();
    onPressStart(null);
  });

  talkBtn.addEventListener('keyup', function (event) {
    if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'Enter') return;
    event.preventDefault();
    onPressEnd();
  });

  talkBtn.addEventListener('blur', function () { onPressEnd(); });

  window.addEventListener('blur', function () {
    if (phase === 'recording') stopRecording();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && phase === 'recording') stopRecording();
  });

  /* ---------------------------------------------------------
     Language buttons
     --------------------------------------------------------- */

  langButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var lang = btn.getAttribute('data-lang');
      if (!lang) return;
      if (phase === 'recording' || phase === 'intro' || phase === 'thinking' || micPending) return;
      startIntro(lang);
    });
  });

  /* ---------------------------------------------------------
     Replay / stop
     --------------------------------------------------------- */

  replayBtn.addEventListener('click', replayLastResponse);

  stopPlaybackBtn.addEventListener('click', function () {
    stopPlayback();
    cancelTurn();
    if (phase === 'speaking') setPhase('idle');
  });

  errorRetry.addEventListener('click', function () {
    if (typeof errorRetryFn === 'function') errorRetryFn();
    else clearError();
  });

  /* ---------------------------------------------------------
     Wake lock (optional; keeps long demos from sleeping)
     --------------------------------------------------------- */

  function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* ignore; not all browsers allow this */ });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && phase !== 'language') requestWakeLock();
  });

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */

  window.addEventListener('beforeunload', function () {
    cancelTurn();
    stopPlayback();
    releaseMic();
    if (healthTimer) window.clearInterval(healthTimer);
  });

  applyLanguage('nl');
  showScreen('language');
  clearResult();
  showHint('');
  render();
  checkHealth(false);
  requestWakeLock();

  healthTimer = window.setInterval(function () { checkHealth(true); }, HEALTH_INTERVAL_MS);

})();
