// --------- iPhone-style lock screen clock ---------
(function () {
  const timeEl = document.getElementById('lockTime');
  const dateEl = document.getElementById('lockDate');
  if (!timeEl || !dateEl) return;

  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const paddedMinutes = minutes < 10 ? '0' + minutes : String(minutes);
    timeEl.textContent = hours + ':' + paddedMinutes;

    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }

  updateClock();
  setInterval(updateClock, 1000 * 15);
})();

// --------- Password Lock Screen ---------
(function () {
  const CORRECT_PIN = '2710';

  const lockScreen = document.getElementById('lockScreen');
  const lockForm = document.getElementById('lockForm');
  const timerScreen = document.getElementById('timerScreen');
  const lockVideo = document.getElementById('lockVideo');
  const unlockButton = document.getElementById('lockUnlockButton');
  const backspaceButton = document.getElementById('lockBackspace');
  const dots = document.querySelectorAll('#lockPinDots span');
  const keys = document.querySelectorAll('.lock-key[data-key]');
  const lockError = document.getElementById('lockError');
  const lockHint = document.querySelector('#lockScreen .lock-hint');
  const dotsRow = document.getElementById('lockPinDots');
  const keypad = document.querySelector('#lockScreen .lock-keypad');
  const wrongSound = document.getElementById('wrongSound');
  const notifSound = document.getElementById('notifSound');
  const ackSound = document.getElementById('ackSound');
  const wowSound = document.getElementById('wowSound');
  const notifEl = document.getElementById('lockNotif');

  const MAX_ATTEMPTS = 5;      // wrong tries before a short lockout
  const LOCKOUT_SECONDS = 10;  // like iPhone's "try again in..." screen
  const HINT_AFTER = 3;        // show a soft hint after this many wrong tries

  if (!lockScreen || !unlockButton) return;

  let enteredPin = '';
  let wrongAttempts = 0;
  let locked = false;   // lockout countdown running
  let busy = false;     // brief pause while wrong/correct animation plays
  let audioPrimed = false;

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {}
  }

  // Phones only allow sound after a tap, so on the very first tap ("wake")
  // we warm up the other sounds silently. Otherwise they could be blocked.
  function primeSound() {
    if (audioPrimed) return;
    audioPrimed = true;
    [wrongSound, ackSound, wowSound].forEach(function (a) {
      if (!a) return;
      try {
        a.muted = true;
        const p = a.play();
        if (p && p.then) {
          p.then(function () {
            a.pause();
            a.currentTime = 0;
            a.muted = false;
          }).catch(function () {
            a.muted = false;
          });
        } else {
          a.muted = false;
        }
      } catch (e) {
        a.muted = false;
      }
    });
  }

  function playSound(a) {
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
      a.muted = false;
      a.volume = 1;
      const p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function playWrongSound() {
    playSound(wrongSound);
  }

  // "fahhhhh" first, then the lockout "ack" sound right after it finishes
  // (falls back to a timer if the wrong-sound file is missing).
  function playAckAfterWrong() {
    let done = false;
    function go() {
      if (done) return;
      done = true;
      if (wrongSound) wrongSound.removeEventListener('ended', go);
      playSound(ackSound);
    }
    if (wrongSound) wrongSound.addEventListener('ended', go);
    setTimeout(go, 2200);
  }

  // ---- Stages: sleep -> notif (WhatsApp banner) -> pass (passcode) ----
  let stage = 'sleep';
  lockScreen.classList.add('stage-sleep');

  function setStage(next) {
    lockScreen.classList.remove('stage-sleep', 'stage-notif', 'stage-pass');
    lockScreen.classList.add('stage-' + next);
    stage = next;
  }

  function wake() {
    if (stage !== 'sleep') return;
    primeSound();
    playSound(notifSound);
    vibrate([60, 40, 60]);
    setStage('notif');
  }

  function openPasscode() {
    if (stage !== 'notif') return;
    vibrate(10);
    setStage('pass');
  }

  lockScreen.addEventListener('click', function () {
    if (stage === 'sleep') wake();
    else if (stage === 'notif') openPasscode();
  });

  // swipe up on the notification also opens it, like a real iPhone
  if (notifEl) {
    let touchY = null;
    notifEl.addEventListener('touchstart', function (e) {
      touchY = e.touches[0].clientY;
    }, { passive: true });
    notifEl.addEventListener('touchend', function (e) {
      if (touchY !== null && touchY - e.changedTouches[0].clientY > 30) openPasscode();
      touchY = null;
    }, { passive: true });
  }

  function renderPin() {
    dots.forEach(function (dot, index) {
      const digit = enteredPin.charAt(index);
      dot.textContent = digit;
      dot.classList.toggle('filled', Boolean(digit));
      dot.setAttribute('aria-label', digit ? 'Entered digit ' + digit : 'Empty');
    });
  }

  function clearPin() {
    enteredPin = '';
    renderPin();
  }

  function addDigit(digit) {
    if (stage !== 'pass' || locked || busy || enteredPin.length >= 4) return;

    vibrate(8);

    enteredPin += digit;

    if (lockError) lockError.textContent = '';
    renderPin();

    // Real iPhones check the passcode automatically the moment the last
    // digit is entered — no separate "Unlock" tap needed.
    if (enteredPin.length === 4) {
      setTimeout(checkPin, 220);
    }
  }

  function removeDigit() {
    if (stage !== 'pass' || locked || busy || !enteredPin.length) return;

    enteredPin = enteredPin.slice(0, -1);

    if (lockError) lockError.textContent = '';
    renderPin();
  }

  function goToTimer() {
    document.body.classList.add('timer-active');
    lockScreen.classList.add('is-unlocked');

    if (timerScreen) {
      timerScreen.classList.add('is-visible');
    } else {
      finishEntry();
    }
    renderPin();
  }

  function finishEntry() {
    try {
      sessionStorage.setItem('bdayEntered', 'yes');
    } catch (e) {}

    if (lockVideo) {
      try {
        lockVideo.pause();
      } catch (e) {}
    }

    if (lockScreen) lockScreen.classList.add('is-unlocked');
    if (timerScreen) timerScreen.classList.remove('is-visible');
    document.body.classList.remove('lock-active');
  }

  window.finishBdayEntry = finishEntry;

  try {
    if (sessionStorage.getItem('bdayEntered') === 'yes') {
      finishEntry();
      return;
    }
  } catch (e) {}

  function startLockout() {
    locked = true;
    if (keypad) keypad.classList.add('is-locked');

    let seconds = LOCKOUT_SECONDS;
    if (lockError) lockError.textContent = 'Too many tries. Try again in ' + seconds + 's';

    const timer = setInterval(function () {
      seconds -= 1;
      if (seconds > 0) {
        if (lockError) lockError.textContent = 'Too many tries. Try again in ' + seconds + 's';
        return;
      }
      clearInterval(timer);
      locked = false;
      wrongAttempts = 0;
      if (keypad) keypad.classList.remove('is-locked');
      if (lockError) lockError.textContent = '';
    }, 1000);
  }

  function checkPin() {
    if (locked || busy || enteredPin.length < 4) return;

    // Correct: dots glow, the lock slides away, then the next page opens.
    if (enteredPin === CORRECT_PIN) {
      busy = true;
      if (lockError) lockError.textContent = '';
      if (dotsRow) dotsRow.classList.add('is-correct');
      playSound(wowSound);
      vibrate(30);

      setTimeout(function () {
        lockScreen.classList.add('is-unlocking');
        document.body.classList.add('timer-active');
      }, 250);

      setTimeout(function () {
        lockScreen.classList.remove('is-unlocking');
        if (dotsRow) dotsRow.classList.remove('is-correct');
        busy = false;
        goToTimer();
      }, 800);
      return;
    }

    // Wrong: "fahhhhh" sound, red shaking dots, buzz on phones.
    wrongAttempts += 1;
    busy = true;
    playWrongSound();
    vibrate([90, 50, 90]);

    if (dotsRow) {
      dotsRow.classList.remove('is-wrong');
      void dotsRow.offsetWidth;
      dotsRow.classList.add('is-wrong');
    }

    if (wrongAttempts >= MAX_ATTEMPTS) {
      startLockout();
      playAckAfterWrong();
    } else if (lockError) {
      lockError.textContent = 'Oops, try again! 🙈';
    }

    if (wrongAttempts >= HINT_AFTER && lockHint) {
      lockHint.textContent = 'Hint: think of a very special date 🎂';
    }

    setTimeout(function () {
      if (dotsRow) dotsRow.classList.remove('is-wrong');
      clearPin();
      busy = false;
    }, 650);
  }

  keys.forEach(function (button) {
    button.addEventListener('click', function () {
      addDigit(button.getAttribute('data-key'));
    });
  });

  if (backspaceButton) {
    backspaceButton.addEventListener('click', removeDigit);
  }

  unlockButton.addEventListener('click', checkPin);

  document.addEventListener('keydown', function (event) {
    if (!lockScreen || lockScreen.classList.contains('is-unlocked')) return;

    if (stage === 'sleep') { wake(); return; }
    if (stage === 'notif') { openPasscode(); return; }

    if (/^\d$/.test(event.key)) {
      addDigit(event.key);
      return;
    }

    if (event.key === 'Backspace') {
      removeDigit();
      return;
    }

    if (event.key === 'Enter') {
      checkPin();
    }
  });

  // Chrome allows this because the video is muted.
  if (lockVideo) {
    lockVideo.play().catch(function () {});
  }

  renderPin();
})();

// --------- Birthday Countdown Timer ---------
(function () {
  const timerScreen = document.getElementById('timerScreen');
  const continueBtn = document.getElementById('timerContinueBtn');
  if (!timerScreen || !continueBtn) return;

  const dEl = document.getElementById('tDays');
  const hEl = document.getElementById('tHours');
  const mEl = document.getElementById('tMins');
  const sEl = document.getElementById('tSecs');
  const subEl = document.getElementById('timerSub');

  function getTarget() {
    const now = new Date();
    let target = new Date(now.getFullYear(), 9, 27, 0, 0, 0); // Oct = month 9
    const endOfBirthday = new Date(now.getFullYear(), 9, 27, 23, 59, 59);
    if (now > endOfBirthday) {
      target = new Date(now.getFullYear() + 1, 9, 27, 0, 0, 0);
    }
    return target;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  let intervalId = null;

  function tick() {
    const now = new Date();
    const target = getTarget();
    const diff = target - now;

    if (diff <= 0) {
      if (dEl) dEl.textContent = '00';
      if (hEl) hEl.textContent = '00';
      if (mEl) mEl.textContent = '00';
      if (sEl) sEl.textContent = '00';
      if (subEl) subEl.textContent = "It's her birthday today! 🎂🎉";
      timerScreen.classList.add('is-birthday');
      continueBtn.textContent = 'Open Her Surprise! 🎉';
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);

    if (dEl) dEl.textContent = pad(days);
    if (hEl) hEl.textContent = pad(hours);
    if (mEl) mEl.textContent = pad(mins);
    if (sEl) sEl.textContent = pad(secs);
  }

  tick();
  intervalId = setInterval(tick, 1000);

  continueBtn.addEventListener('click', function () {
    if (typeof window.finishBdayEntry === 'function') {
      window.finishBdayEntry();
    } else {
      timerScreen.classList.remove('is-visible');
      document.body.classList.remove('lock-active');
    }
  });
})();

// --------- Birthday Greeting & Message Configuration ---------
    window.textLetterH2 = 'Happy Birthday, Princy Didi! 🎂';
    window.textLetterP = 'To my most special Didi, Princy ❤️ Thank you for always caring for me, supporting me, listening to my nonsense, and making life feel a little better. You are not just my sister, you are one of the safest and most special people in my life. I may not always say it, but I am genuinely lucky to have you as my Didi. I hope this year brings you endless smiles, peace, success, and everything your heart wishes for. Love you loads, Didi! 🫶✨';

    const mockData = {
      titleLetter: 'Happy Birthday, Princy Didi! 🎂',
      contentLetter: 'To my most special Didi, Princy ❤️ Thank you for always caring for me, supporting me, listening to my nonsense, and making life feel a little better. You are not just my sister, you are one of the safest and most special people in my life. I may not always say it, but I am genuinely lucky to have you as my Didi. I hope this year brings you endless smiles, peace, success, and everything your heart wishes for. Love you loads, Didi! 🫶✨',
      signatureLetter: 'With lots of love, your little brother ❤️',
      music: 'happybirthday.mp3'
    };

    (function () {
      const pageLoader = document.getElementById('pageLoader');
      function showLoader() { pageLoader && pageLoader.classList.add('show'); document.body.classList.remove('is-loaded'); }
      function hideLoader() { pageLoader && pageLoader.classList.remove('show'); }
      function applyData(data) {
        const title = document.querySelector('#letterScene .textLetter h2');
        const content = document.querySelector('#letterScene .contentLetter');
        const signature = document.querySelector('#letterScene .signature');
        const audio = document.getElementById('bgm');
        if (title) { title.textContent = ''; }
        if (content) { content.textContent = ''; }
        if (signature && typeof data.signatureLetter === 'string') { signature.innerHTML = '<br>' + data.signatureLetter; }
        if (audio && typeof data.music === 'string') { audio.src = data.music; }
      }

      showLoader();

      setTimeout(() => {
        try {
          window.textLetterH2 = typeof mockData.titleLetter === 'string' ? mockData.titleLetter : '';
          window.textLetterP = typeof mockData.contentLetter === 'string' ? mockData.contentLetter : '';
          applyData(mockData);
          hideLoader();
          document.body.classList.add('is-loaded');
        } catch (e) {
          console.error('Initialization error:', e);
          hideLoader();
          document.body.classList.add('is-loaded');
        }
      }, 1200);
    })();

    // Gift box interaction and scene transition trigger
    (function () {
      const box = document.getElementById('giftBox');
      if (!box) return;

      let opened = false;

      function openBox() {
        if (opened) return;
        opened = true;
        box.classList.add('open');
        // Initialize background audio upon user gesture
        (function () {
          var bgm = document.getElementById('bgm');
          if (bgm) {
            try { bgm.volume = 0.6; bgm.play().catch(function () { }); } catch (e) { }
          }
        })();
        // Transition UI to reveal letter scene after gift box opens
        setTimeout(function () {
          document.body.classList.add('hide-ui');
          // Display interactive envelope scene
          const scene = document.getElementById('letterScene');
          if (scene) { scene.style.display = 'block'; }
          // Initialize SVG path animations and letter interactions
          initLetterScene();
        }, 1000);
      }
      box.addEventListener('click', openBox, { passive: true });
      box.addEventListener('pointerdown', openBox, { passive: true });
      box.addEventListener('touchstart', openBox, { passive: true });
    })();

    // Prevent unintended gesture zooming on mobile browsers
    (function () {
      function isMobile() { return /Mobi|Android|iPad|iPhone|iPod/i.test(navigator.userAgent); }
      if (!isMobile()) return;

      // Intercept gesture zoom and Ctrl+wheel scaling
      document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
      document.addEventListener('gesturechange', function (e) { e.preventDefault(); }, { passive: false });
      document.addEventListener('gestureend', function (e) { e.preventDefault(); }, { passive: false });
      document.addEventListener('wheel', function (e) { if (e.ctrlKey) { e.preventDefault(); } }, { passive: false, capture: true });

      // Intercept double-tap zoom delay
      let lastTouchEnd = 0;
      document.addEventListener('touchend', function (e) {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) { e.preventDefault(); }
        lastTouchEnd = now;
      }, { passive: false });

      // Intercept multi-touch pinch gestures
      document.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length > 1) { e.preventDefault(); }
      }, { passive: false });
    })();

    // ==========================================================
    // FLOATING BALLOONS & CELEBRATION ATMOSPHERE (ALL PAGES)
    // ==========================================================
    var balloonsInitialized = false;
    function initFloatingBalloons() {
      if (balloonsInitialized) return;
      balloonsInitialized = true;

      var sky = document.getElementById('celebrationSky');
      if (!sky) return;

      var balloonColors = [
        'radial-gradient(circle at 35% 30%, #fff 0%, #ff8da1 40%, #ff477e 100%)',
        'radial-gradient(circle at 35% 30%, #fff 0%, #ffe066 40%, #f59f00 100%)',
        'radial-gradient(circle at 35% 30%, #fff 0%, #d0bfff 40%, #845ef7 100%)',
        'radial-gradient(circle at 35% 30%, #fff 0%, #ffa8a8 40%, #fa5252 100%)',
        'radial-gradient(circle at 35% 30%, #fff 0%, #ffc9c9 40%, #ff6b8b 100%)',
        'radial-gradient(circle at 35% 30%, #fff 0%, #b2f2bb 40%, #20c997 100%)'
      ];

      // Balanced 5-Zone sectors to ensure equal distribution across Left, Center, Right
      var balloonSectors = [
        { min: 2, max: 20 },   // Far Left
        { min: 21, max: 39 },  // Mid Left
        { min: 40, max: 60 },  // Center
        { min: 61, max: 79 },  // Mid Right
        { min: 80, max: 97 }   // Far Right
      ];
      var currentBalloonSectorIdx = 0;

      function spawnBalloon(preferredSector) {
        var b = document.createElement('div');
        b.className = 'floating-balloon';
        
        var isHeart = Math.random() > 0.45;
        
        // Pick sector in round-robin to guarantee 100% even coverage on all sides
        var sector = preferredSector !== undefined ? balloonSectors[preferredSector % balloonSectors.length] : balloonSectors[currentBalloonSectorIdx];
        if (preferredSector === undefined) {
          currentBalloonSectorIdx = (currentBalloonSectorIdx + 1) % balloonSectors.length;
        }

        var startX = Math.random() * (sector.max - sector.min) + sector.min;
        var duration = Math.random() * 4 + 6.5; // 6.5s to 10.5s
        var scale = Math.random() * 0.35 + 0.85; // 0.85 to 1.2
        var swayDistance = (Math.random() * 25 + 15) * (Math.random() > 0.5 ? 1 : -1);

        b.style.left = startX + 'vw';
        b.style.transform = 'scale(' + scale + ')';

        if (isHeart) {
          b.innerHTML = '<div class="heart-balloon">💖<div class="balloon-string"></div></div>';
        } else {
          var bg = balloonColors[Math.floor(Math.random() * balloonColors.length)];
          b.innerHTML = '<div class="balloon-body" style="background: ' + bg + ';"><div class="balloon-knot" style="background: ' + bg + ';"></div><div class="balloon-string"></div></div>';
        }

        sky.appendChild(b);

        // Animate upwards with natural floating sway
        var startTime = null;
        function animateBalloon(timestamp) {
          if (!startTime) startTime = timestamp;
          var progress = (timestamp - startTime) / (duration * 1000);
          if (progress >= 1) {
            if (b.parentNode) b.remove();
            return;
          }
          var currentY = progress * 135; // 0vh to 135vh up
          var currentX = Math.sin(progress * Math.PI * 3) * swayDistance;
          b.style.bottom = (currentY - 15) + 'vh';
          b.style.transform = 'translateX(' + currentX + 'px) scale(' + scale + ')';
          requestAnimationFrame(animateBalloon);
        }
        requestAnimationFrame(animateBalloon);
      }

      // Initial burst of 10 balloons evenly spaced across all 5 zones (left, center, right)
      for (var i = 0; i < 10; i++) {
        (function(idx) {
          setTimeout(function() {
            spawnBalloon(idx % 5);
          }, idx * 180);
        })(i);
      }

      // Continuous evenly-distributed balloon spawner across all sides
      setInterval(function() {
        spawnBalloon();
      }, 700);

      // Balanced Falling Rose Petals
      var petalSectors = [
        { min: 0, max: 20 },
        { min: 20, max: 40 },
        { min: 40, max: 60 },
        { min: 60, max: 80 },
        { min: 80, max: 100 }
      ];
      var currentPetalSectorIdx = 0;

      function spawnPetal(preferredSector) {
        var p = document.createElement('div');
        p.className = 'floating-petal';

        var sector = preferredSector !== undefined ? petalSectors[preferredSector % petalSectors.length] : petalSectors[currentPetalSectorIdx];
        if (preferredSector === undefined) {
          currentPetalSectorIdx = (currentPetalSectorIdx + 1) % petalSectors.length;
        }

        var startX = Math.random() * (sector.max - sector.min) + sector.min;
        p.style.left = startX + 'vw';
        
        var dur = Math.random() * 4 + 6;
        var size = Math.random() * 8 + 12;
        p.style.width = size + 'px';
        p.style.height = (size * 1.3) + 'px';
        sky.appendChild(p);

        var startT = null;
        var startRot = Math.random() * 360;
        var petalSway = (Math.random() * 35 + 20) * (Math.random() > 0.5 ? 1 : -1);
        
        function animatePetal(ts) {
          if (!startT) startT = ts;
          var prog = (ts - startT) / (dur * 1000);
          if (prog >= 1) {
            if (p.parentNode) p.remove();
            return;
          }
          var y = prog * 115;
          var x = Math.sin(prog * Math.PI * 4) * petalSway;
          p.style.top = y + 'vh';
          p.style.transform = 'translateX(' + x + 'px) rotate(' + (startRot + prog * 360) + 'deg)';
          requestAnimationFrame(animatePetal);
        }
        requestAnimationFrame(animatePetal);
      }

      for (var j = 0; j < 8; j++) {
        (function(idx) {
          setTimeout(function() {
            spawnPetal(idx % 5);
          }, idx * 220);
        })(j);
      }
      setInterval(function() {
        spawnPetal();
      }, 950);
    }

    // ==========================================================
    // BIRTHDAY INTERACTIVE JOURNEY CONTROLLER
    // ==========================================================
    function startBirthdayJourney() {
      var container = document.getElementById('birthdayJourneyContainer');
      if (!container) return;
      
      container.style.display = 'flex';
      container.style.opacity = '0';

      var cakeStage = document.getElementById('cakeStage');
      if (cakeStage) {
        cakeStage.style.display = 'block';
        cakeStage.classList.remove('stage-exit-active');
        cakeStage.classList.add('stage-enter-active');
      }

      requestAnimationFrame(function () {
        container.style.transition = 'opacity 0.4s ease';
        container.style.opacity = '1';
      });

      // Confetti helper
      function launchConfetti(opts) {
        if (typeof confetti === 'function') {
          confetti({
            particleCount: opts && opts.count ? opts.count : 50,
            spread: opts && opts.spread ? opts.spread : 70,
            origin: opts && opts.origin ? opts.origin : { y: 0.6 },
            colors: ['#ff477e', '#ff8da1', '#ffd1dc', '#ffea79', '#a0c4ff', '#caffbf', '#ffd700']
          });
        }
      }

      // Initial entrance confetti
      launchConfetti({ count: 45, spread: 65, origin: { y: 0.5 } });

      // --- STAGE 1: CAKE & CANDLE ---
      var candleBlown = false;
      var interactiveCake = document.getElementById('interactiveCake');
      var candleFlame = document.getElementById('candleFlame');
      var candleSmoke = document.getElementById('candleSmoke');
      var cakeTapHint = document.getElementById('cakeTapHint');
      var wishMadeText = document.getElementById('wishMadeText');
      var toMemoriesBtn = document.getElementById('toMemoriesBtn');

      function blowCandle() {
        if (candleBlown) return;
        candleBlown = true;
        if (candleFlame) candleFlame.classList.add('blown-out');
        if (candleSmoke) candleSmoke.classList.add('active');
        if (cakeTapHint) cakeTapHint.style.display = 'none';
        
        // Celebration confetti explosions
        launchConfetti({ count: 120, spread: 100, origin: { y: 0.5 } });
        setTimeout(function () {
          launchConfetti({ count: 80, spread: 80, origin: { y: 0.4 } });
        }, 350);

        if (wishMadeText) wishMadeText.style.display = 'block';
        if (toMemoriesBtn) toMemoriesBtn.style.display = 'inline-flex';
      }

      if (interactiveCake) {
        interactiveCake.onclick = blowCandle;
      }

      // Silky Smooth Stage switcher helper
      function switchStage(fromId, toId) {
        var fromStage = document.getElementById(fromId);
        var toStage = document.getElementById(toId);
        if (!fromStage || !toStage) return;

        fromStage.classList.remove('stage-enter-active');
        fromStage.classList.add('stage-exit-active');

        setTimeout(function () {
          fromStage.style.display = 'none';
          fromStage.classList.remove('stage-exit-active');
          toStage.style.display = 'block';
          toStage.classList.add('stage-enter-active');
          launchConfetti({ count: 35, spread: 60, origin: { y: 0.7 } });
        }, 320);
      }

      // Switch to Stage 2 (Polaroids)
      if (toMemoriesBtn) {
        toMemoriesBtn.onclick = function () {
          switchStage('cakeStage', 'polaroidStage');
        };
      }

      // --- STAGE 2: POLAROID STACK WITH SMOOTH PHYSICS ---
      var currentPolaroid = 0;
      var cards = document.querySelectorAll('.polaroid-card');
      var dots = document.querySelectorAll('#polaroidDots .dot');
      var nextPolaroidBtn = document.getElementById('nextPolaroidBtn');
      var toScratchBtn = document.getElementById('toScratchBtn');
      var polaroidDeck = document.getElementById('polaroidDeck');

      function showPolaroid(idx, prevIdx) {
        if (prevIdx !== undefined && cards[prevIdx]) {
          cards[prevIdx].classList.add('swiped-out');
          cards[prevIdx].classList.remove('active');
        }

        cards.forEach(function (c, i) {
          if (i === idx) {
            c.classList.remove('swiped-out');
            c.classList.add('active');
          } else if (i > idx) {
            c.classList.remove('active', 'swiped-out');
          }
        });

        dots.forEach(function (d, i) {
          d.classList.toggle('active', i === idx);
        });

        if (idx >= cards.length - 1) {
          if (nextPolaroidBtn) nextPolaroidBtn.style.display = 'none';
          if (toScratchBtn) {
            toScratchBtn.style.display = 'inline-flex';
            toScratchBtn.classList.add('stage-enter-active');
          }
        }
      }

      function advancePolaroid() {
        if (currentPolaroid < cards.length - 1) {
          var prev = currentPolaroid;
          currentPolaroid++;
          showPolaroid(currentPolaroid, prev);
          launchConfetti({ count: 25, spread: 45, origin: { y: 0.6 } });
        }
      }

      if (nextPolaroidBtn) {
        nextPolaroidBtn.onclick = advancePolaroid;
      }
      if (polaroidDeck) {
        polaroidDeck.onclick = advancePolaroid;
      }

      // Switch to Stage 3 (Scratch Cards)
      if (toScratchBtn) {
        toScratchBtn.onclick = function () {
          switchStage('polaroidStage', 'scratchStage');
        };
      }

      // --- STAGE 3: SCRATCH CARDS ---
      var scratchCards = document.querySelectorAll('.scratch-card');
      var toFinaleBtn = document.getElementById('toFinaleBtn');
      var revealedCount = 0;

      scratchCards.forEach(function (sc) {
        sc.onclick = function () {
          if (this.classList.contains('revealed')) return;
          this.classList.add('revealed');
          revealedCount++;
          launchConfetti({ count: 45, spread: 60, origin: { y: 0.6 } });

          if (revealedCount >= scratchCards.length) {
            if (toFinaleBtn) {
              toFinaleBtn.style.display = 'inline-flex';
              setTimeout(function () {
                launchConfetti({ count: 100, spread: 90, origin: { y: 0.5 } });
              }, 300);
            }
          }
        };
      });

      // Switch to Stage 4 (Finale)
      if (toFinaleBtn) {
        toFinaleBtn.onclick = function () {
          switchStage('scratchStage', 'finaleStage');
          // Grand finale celebratory fireworks
          var finaleCounter = 0;
          var finaleInterval = setInterval(function () {
            var finaleEl = document.getElementById('finaleStage');
            if (finaleEl && finaleEl.style.display === 'block' && finaleCounter < 15) {
              finaleCounter++;
              launchConfetti({
                count: 50,
                spread: 85,
                origin: { x: Math.random() * 0.8 + 0.1, y: Math.random() * 0.5 + 0.2 }
              });
            } else {
              clearInterval(finaleInterval);
            }
          }, 1200);
        };
      }

      // --- STAGE 4: FINALE CONTROLS ---
      var replayBtn = document.getElementById('replayJourneyBtn');
      var toggleMusicBtn = document.getElementById('toggleMusicBtn');
      var bgm = document.getElementById('bgm');

      if (replayBtn) {
        replayBtn.onclick = function () {
          location.reload();
        };
      }

      if (toggleMusicBtn && bgm) {
        toggleMusicBtn.onclick = function () {
          if (bgm.paused) {
            bgm.play().catch(function () {});
            toggleMusicBtn.innerHTML = '<i class="fa-solid fa-music"></i> <span>Music: ON</span>';
          } else {
            bgm.pause();
            toggleMusicBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> <span>Music: OFF</span>';
          }
        };
      }
    }

    // ------------ Interactive Envelope & Letter Scene Orchestration -------------
    function initLetterScene() {
      try {
        // Initialize celebration floating balloons & ambient atmosphere
        initFloatingBalloons();

        // SVG animated path tracing for the heart envelope contour
        var SVG_NS = "http://www.w3.org/2000/svg";
        var shape = document.getElementById('shape');
        var partialPath = document.getElementById('partialPath');
        var theSvg = document.getElementById('theSvg');

        if (shape && partialPath && theSvg) {
          var rid = null;
          var pathlength = shape.getTotalLength();
          var t = 0;
          var lengthAtT = pathlength * t;
          var d = shape.getAttribute('d');
          var n = (d.match(/C/gi) || []).length;
          var pos = 0;

          class SubPath {
            constructor(sd) {
              this.d = sd;
              this.getPoints();
              this.previous = subpaths.length > 0 ? subpaths[subpaths.length - 1] : null;
              this.measurePath();
              this.getMovePoint();
              this.lastCubicBezier = undefined;
              this.getLastCubicBezier();
            }
            getPoints() {
              this.pointsRy = [];
              var temp = this.d.split(/[A-Z,a-z\s,]/).filter(Boolean);
              temp.forEach(function (item) { this.pointsRy.push(parseFloat(item)); }, this);
            }
            measurePath() {
              var p = document.createElementNS(SVG_NS, 'path');
              p.setAttributeNS(null, 'd', this.d);
              this.pathLength = p.getTotalLength();
            }
            getMovePoint() {
              if (this.previous) {
                var p = this.previous.pointsRy; var l = p.length;
                this.M_point = [p[l - 2], p[l - 1]];
              } else {
                var p = this.pointsRy; this.M_point = [p[0], p[1]];
              }
            }
            getLastCubicBezier() {
              var lastIndexOfC = this.d.lastIndexOf('C');
              var temp = this.d.substring(lastIndexOfC + 1).split(/[\s,]/).filter(Boolean);
              var nums = []; temp.forEach(function (item) { nums.push(parseFloat(item)); });
              this.lastCubicBezier = [this.M_point];
              for (var i = 0; i < nums.length; i += 2) { this.lastCubicBezier.push(nums.slice(i, i + 2)); }
            }
          }

          var subpaths = [];
          for (var i = 0; i < n; i++) {
            var newpos = d.indexOf('C', pos + 1);
            if (i > 0) { subpaths.push(new SubPath(d.substring(0, newpos))); }
            pos = newpos;
          }
          subpaths.push(new SubPath(d));

          var index = 0;
          for (index = 0; index < subpaths.length; index++) {
            if (subpaths[index].pathLength >= lengthAtT) { break; }
          }
          function get_T(tt, idx) {
            lengthAtT = pathlength * tt; var T;
            if (idx > 0) {
              T = (lengthAtT - subpaths[idx].previous.pathLength) / (subpaths[idx].pathLength - subpaths[idx].previous.pathLength);
            } else { T = lengthAtT / subpaths[idx].pathLength; }
            return T;
          }
          function lerp(A, B, tt) { return [(B[0] - A[0]) * tt + A[0], (B[1] - A[1]) * tt + A[1]]; }
          function getBezierPoints(tt, points) {
            var helper = [];
            for (var i = 1; i < 4; i++) { helper.push(lerp(points[i - 1], points[i], tt)); }
            helper.push(lerp(helper[0], helper[1], tt));
            helper.push(lerp(helper[1], helper[2], tt));
            helper.push(lerp(helper[3], helper[4], tt));
            return [points[0], helper[0], helper[3], helper[5]];
          }
          function drawCBezier(points) {
            var dd;
            if (index > 0) { dd = subpaths[index].previous.d; }
            else { dd = `M${points[0][0]},${points[0][1]} C`; }
            for (var i = 1; i < 4; i++) { dd += ` ${points[i][0]},${points[i][1]} `; }
            partialPath.setAttributeNS(null, 'd', dd);
          }
          theSvg.style.display = 'inherit';
          function Typing() {
            rid = window.requestAnimationFrame(Typing);
            if (t >= 1) { window.cancelAnimationFrame(rid); rid = null; }
            else { t += 0.0025; }
            lengthAtT = pathlength * t;
            for (index = 0; index < subpaths.length; index++) {
              if (subpaths[index].pathLength >= lengthAtT) { break; }
            }
            var T = get_T(t, index);
            var newPoints = getBezierPoints(T, subpaths[index].lastCubicBezier);
            drawCBezier(newPoints);
          }
          rid = window.requestAnimationFrame(Typing);
        }

        // Letter typing animation helpers (Smooth, readable, emotional typewriter)
        var textLetter = document.querySelector('#letterScene .textLetter h2');
        var textLetterContent = document.querySelector('#letterScene .contentLetter');
        var typingTimer = null;

        function startSmoothTypewriter() {
          if (typingTimer) clearTimeout(typingTimer);
          
          var titleSrc = (window.textLetterH2 || 'Happy Birthday, Princy Didi! 🎂');
          var contentSrc = (window.textLetterP || 'To the most wonderful girl in my life...');
          
          if (textLetter) textLetter.textContent = '';
          if (textLetterContent) textLetterContent.textContent = '';

          var tIdx = 0;
          function typeTitle() {
            if (tIdx < titleSrc.length) {
              if (textLetter) textLetter.textContent += titleSrc[tIdx];
              tIdx++;
              typingTimer = setTimeout(typeTitle, 85); // Natural gentle pace for title
            } else {
              // Pause before typing message body
              typingTimer = setTimeout(startContent, 350);
            }
          }

          var cIdx = 0;
          function startContent() {
            function typeContent() {
              if (cIdx < contentSrc.length) {
                if (textLetterContent) textLetterContent.textContent += contentSrc[cIdx];
                cIdx++;
                // Natural typing cadence (slight pause after punctuation)
                var char = contentSrc[cIdx - 1];
                var delay = (char === '.' || char === '!' || char === '?' || char === ',') ? 160 : 60;
                typingTimer = setTimeout(typeContent, delay);
              }
            }
            typeContent();
          }

          typeTitle();
        }

        function funcTimeoutLetter() {
          startSmoothTypewriter();
        }

        // Open letter function
        function openLetterModal() {
          var card = document.querySelector('#letterScene .card');
          var valentines = document.querySelector('#letterScene .valentines');
          var wrapper = document.querySelector('#letterScene .wrapperLetterForm');
          var formLetter = document.querySelector('#letterScene .formLetter');
          var hint = document.querySelector('.envelope-hint');
          if (hint) hint.style.display = 'none';
          if (valentines) valentines.classList.add('is-open');

          if (card && window.jQuery) {
            window.jQuery(card).stop().animate({ top: '-90px' }, 300);
          } else if (card) {
            card.style.top = '-90px';
          }

          setTimeout(function () {
            if (formLetter) {
              formLetter.style.transform = 'scale(1) translateY(0)';
              formLetter.style.opacity = '1';
            }
            if (wrapper) {
              wrapper.style.display = 'flex';
              if (window.jQuery) {
                window.jQuery(wrapper).fadeIn(350);
              }
            }
            funcTimeoutLetter();
          }, 180);
        }

        // Attach envelope tap & click listeners
        var clickableTargets = document.querySelectorAll('#letterScene .valentines, #letterScene .card, #letterScene .envelope, #letterScene .front, #letterScene .hearts, #castle');
        clickableTargets.forEach(function (el) {
          el.style.cursor = 'pointer';
          el.onclick = function (e) {
            e.stopPropagation();
            openLetterModal();
          };
        });

        if (window.jQuery) {
          window.jQuery('.valentines').off('mouseenter mouseleave').on('mouseenter', function () {
            window.jQuery(this).addClass('is-open');
            window.jQuery('.card').stop().animate({ top: '-90px' }, 'slow');
          }).on('mouseleave', function () {
            window.jQuery(this).removeClass('is-open');
            window.jQuery('.card').stop().animate({ top: 0 }, 'slow');
          });
        }

        // Next button inside letter: Transitions directly & cleanly to Cake stage without any background flash
        var nextBtns = document.querySelectorAll('.letterNextBtn');
        nextBtns.forEach(function (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            var formLetter = document.querySelector('#letterScene .formLetter');
            var wrapper = document.querySelector('#letterScene .wrapperLetterForm');
            var letterScene = document.getElementById('letterScene');
            var theSvg = document.getElementById('theSvg');
            var castle = document.getElementById('castle');

            // 1. Instantly remove background SVG heart text and envelope so they never flash
            if (theSvg) theSvg.style.display = 'none';
            if (castle) castle.style.display = 'none';

            // 2. Smoothly zoom and fade the letter card
            if (formLetter) {
              formLetter.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
              formLetter.style.transform = 'scale(0.92) translateY(-15px)';
              formLetter.style.opacity = '0';
            }
            if (wrapper) {
              wrapper.style.transition = 'opacity 0.3s ease';
              wrapper.style.opacity = '0';
            }

            // 3. Directly launch the Birthday Cake stage with silky smooth spring animation
            setTimeout(function () {
              if (wrapper) wrapper.style.display = 'none';
              if (letterScene) {
                letterScene.style.display = 'none';
                document.body.classList.add('final-hide');
              }
              startBirthdayJourney();
            }, 300);
          };
        });

        // Close letter button (fa-xmark)
        var closeBtns = document.querySelectorAll('#letterScene .fa-xmark');
        closeBtns.forEach(function (cb) {
          cb.onclick = function () {
            var wrapper = document.querySelector('#letterScene .wrapperLetterForm');
            if (wrapper) wrapper.style.display = 'none';
          };
        });

        // Ambient sparkling magical dust particles
        var head = document.getElementsByTagName('head')[0];
        var animationId = 1;
        function CreateMagicDust(x1, x2, y1, y2, sizeRatio, fallingTime, animationDelay, node = 'castle') {
          var dust = document.createElement('span');
          var animation = document.createElement('style');
          animation.innerHTML = `@keyframes blink${animationId}{0%{top:${y1}px;left:${x1}px;width:${2 * sizeRatio}px;height:${2 * sizeRatio}px;opacity:.4}20%{width:${4 * sizeRatio}px;height:${4 * sizeRatio}px;opacity:.8}35%{width:${2 * sizeRatio}px;height:${2 * sizeRatio}px;opacity:.5}55%{width:${3 * sizeRatio}px;height:${3 * sizeRatio}px;opacity:.7}80%{width:${sizeRatio}px;height:${sizeRatio}px;opacity:.3}100%{top:${y2}px;left:${x2}px;width:0px;height:0px;opacity:.1}}`;
          head.appendChild(animation);
          dust.classList.add('dustDef');
          dust.setAttribute('style', `animation: blink${animationId++} ${fallingTime}s cubic-bezier(.71,.11,.68,.83) infinite ${animationDelay}s`);
          var parent = document.getElementById(node) || document.getElementById('letterScene');
          parent && parent.appendChild(dust);
        }
        [[130, 132, 150, 152, .15, 2.5, .1, 'castle'],
        [65, 63, 300, 299, .5, 2, .2, 'castle'],
        [70, 70, 150, 150, .45, 2, .5],
        [75, 78, 160, 170, .6, 2, 1],
        [80, 82, 160, 180, .6, 1, .4],
        [85, 100, 160, 170, .5, 2, .5],
        [125, 110, 170, 180, .25, 3, 1.5],
        [90, 90, 115, 115, .4, 2, 2],
        [93, 95, 200, 200, .4, 3, 1.5],
        [100, 100, 145, 155, .45, 1, .5],
        [100, 90, 170, 230, .35, 2, .75],
        [100, 102, 115, 112, .35, 3, .25],
        [100, 95, 170, 200, .55, 1.5, .75],
        [100, 97, 150, 190, .7, 2, 1.5],
        [105, 100, 160, 180, .5, 1.5, .725],
        [125, 125, 180, 190, .25, 1, .725],
        [130, 130, 135, 135, .45, 3, 1.5],
        [135, 132, 170, 190, .25, 2.5, .75],
        [135, 132, 320, 315, .2, 5, .3, 'castle']
        ].forEach(function (o) { CreateMagicDust(...o); });
      } catch (err) {
        console.error('Letter scene error:', err);
      }
    }

// Ensure the original birthday hero is restored when the password gate finishes.
window.addEventListener('birthdayUnlocked', function () {
  document.body.classList.remove('hide-ui');
  document.body.classList.remove('final-hide');
});

// --------- Shared Birthday Background Video ---------
(function () {
  const siteVideo = document.getElementById('siteBackgroundVideo');
  if (!siteVideo) return;

  function playSiteVideo() {
    siteVideo.muted = true;
    siteVideo.play().catch(function () {});
  }

  playSiteVideo();
  window.addEventListener('load', playSiteVideo, { once: true });

  window.addEventListener('birthdayUnlocked', function () {
    playSiteVideo();
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) playSiteVideo();
  });
})();

// --------- Keep shared background video playing through the countdown ---------
(function () {
  const video = document.getElementById('siteBackgroundVideo');
  if (!video) return;

  function resume() {
    video.muted = true;
    video.play().catch(function () {});
  }

  window.addEventListener('load', resume, { once: true });
  window.addEventListener('birthdayUnlocked', resume);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) resume();
  });
})();

// --------- Timer button defensive interaction ---------
(function () {
  const timer = document.getElementById('timerScreen');
  const continueBtn = document.getElementById('timerContinueBtn');
  if (!timer || !continueBtn) return;

  continueBtn.style.pointerEvents = 'auto';

  continueBtn.addEventListener('click', function () {
    document.body.classList.remove('lock-active');
  }, { capture: true });
})();
