const { ipcRenderer, remote } = require('electron');
const numberToWords = require('number-to-words');

// Object that caches all the DOM elements used
const domElements = {
  remaining: document.querySelector('#remaining'),
  counter: document.querySelector('#counter'),
  progress: document.querySelector('#progress'),
  info: document.querySelector('#info'),
  buttons: {
    pause: document.querySelector('#pause'),
    restart: document.querySelector('#restart'),
    muteOn: document.querySelector('#mute-on'),
    muteOff: document.querySelector('#mute-off'),
    exit: document.querySelector('#exit'),
  },
  audio: {
    beep: document.querySelector('#beep'),
  },
};

// Object containing strings used in the counter
const text = {
  remaining: {
    multiple: ' stations remaining',
    single: 'Last station',
    none: 'No more stations',
  },
  counter: {
    end: '0',
  },
  info: {
    active: 'Complete your activity',
    coolDown: 'Go to your next station',
    complete: 'Return to your original station',
  },
};

// Object containing values for duration, break duration and number of repeats
let settings = null;

// Flag indicating whether or not the program is currently in a paused state
let paused = false;

const toSentenceCase = str =>
  // If a string is given and it is not empty, convert it to a "Sentence case" string
  ((typeof str === 'string' && str.length > 0) ?
    str.charAt(0).toUpperCase() + str.substring(1).toLowerCase() :
    '');

const ensureArray = arr =>
  // If a single element is given, place it in an array
  (Array.isArray(arr) ? arr : [arr]);

const optionalCallback = func =>
  // Executes a function if it is given and if not then a noop function is executed
  (typeof func === 'function' ? func : () => {})();

const skipTransition = (elements, action) => {
  optionalCallback(action);
  ensureArray(elements).forEach((el) => {
    el.classList.add('skip-transition');
    (() => el.offsetHeight)(); // Trigger CSS reflow to flush changes
    el.classList.remove('skip-transition');
  });
};

const mute = () => {
  remote.getCurrentWebContents().setAudioMuted(true);
  domElements.buttons.muteOn.hideButton();
  domElements.buttons.muteOff.showButton();
};

const unmute = () => {
  remote.getCurrentWebContents().setAudioMuted(false);
  domElements.buttons.muteOff.hideButton();
  domElements.buttons.muteOn.showButton();
};

const setProgressBar = () => {
  skipTransition(domElements.progress, () =>
    domElements.progress.classList.remove('expand'));
  domElements.progress.classList.add('expand');
};

const getFormattedTime = (seconds) => {
  // --- Get units of time (from seconds up to hours) ---
  let hh = parseInt(seconds / 3600, 10);
  let mm = parseInt((seconds % 3600) / 60, 10);
  let ss = parseInt(seconds % 60, 10);

  // --- Displaying or hiding units based on length of time (up to hours) ---
  // Hours
  if (hh > 0) {
    hh = `${hh}:`;
  } else {
    hh = '';
  }
  // Minutes
  if (hh === '' && mm <= 0) {
    mm = '';
  } else if (hh !== '' && mm < 10) {
    mm = `0${mm}:`;
  } else {
    mm = `${mm}:`;
  }
  // Seconds
  if (mm !== '' && ss < 10) {
    ss = `0${ss}`;
  }

  return `${hh}${mm}${ss}`;
};

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const pauseWait = () =>
  // The pause-wait channel will return a value of false when the pause modal is
  // closed, which we can set to the paused flag. When the flag is set, the
  // Promise will be resolved.
  Promise.resolve(paused = ipcRenderer.sendSync('pause-wait'));

const countdown = (duration, counterView, onEachSecond) => {
  let currentSecond = duration;

  const action = () => {
    optionalCallback(onEachSecond);
    counterView.textContent = getFormattedTime(currentSecond);
    currentSecond -= 1;
  };

  return Promise.resolve((async () => {
    // The current second will be decremented each second in the action function
    while (currentSecond > 0) {
      /* eslint-disable no-await-in-loop */
      if (paused) {
      // Since the loop should not continue when in a paused state,
      // the loop is blocked until the pause promise is resolved
        await pauseWait();
      } else {
        action();
        // After completing the countdown decrementing action,
        // the loop must be blocked for a second (1000ms) before resuming the countdown
        await sleep(1000);
      }
      /* eslint-enable no-await-in-loop */
    }

    // Check for pause request before ending the countdown
    if (paused) {
      await pauseWait();
    }
  })());
};

domElements.buttons.pause.setAction(() => {
  paused = true;
  ipcRenderer.send('pause');
});

domElements.buttons.restart.setAction(() => remote.getCurrentWebContents().send('start-timer', settings));

domElements.buttons.muteOn.setAction(() => {
  mute();
});

domElements.buttons.muteOff.setAction(() => {
  unmute();
});

domElements.buttons.exit.setAction(() => ipcRenderer.send('exit'));

// Since the counter has no pointer events when counting, this will only
// trigger at the end when the end class is added to the counter, which
// enables pointer events.
domElements.counter.addEventListener('click', () => ipcRenderer.send('exit'));

ipcRenderer.on('start-timer', (evt, userSettings) => {
  const { duration, breakDuration, numRepeats } = userSettings;
  settings = userSettings;

  const resetTimer = () => {
    // Set muted button based on whether or not the audio is mutedd
    if (remote.getCurrentWebContents().isAudioMuted()) {
      mute();
    } else {
      unmute();
    }
    // Reset elements to their intended initial visibility
    domElements.buttons.restart.hideButton();
    domElements.buttons.pause.showButton();
    // Remove all classes from the views
    document.body.classList = '';
    domElements.counter.classList = '';
    domElements.progress.classList = '';
    domElements.info.classList = '';
  };

  const durationCountdown = () => {
    domElements.counter.classList.remove('red');
    domElements.counter.classList.add('primary');
    domElements.progress.classList.remove('red');
    domElements.info.textContent = text.info.active;
    return countdown(duration, domElements.counter, setProgressBar);
  };

  const breakDurationCountdown = () => {
    domElements.counter.classList.remove('primary');
    domElements.counter.classList.add('red');
    domElements.progress.classList.add('red');
    domElements.info.textContent = text.info.coolDown;
    return countdown(breakDuration, domElements.counter, () => {
      domElements.audio.beep.play();
      setProgressBar();
    });
  };

  const endTimer = () => {
    // Setting end classes
    domElements.progress.classList.add('remove');
    skipTransition(domElements.counter, () =>
      domElements.counter.classList.remove('red'));
    domElements.counter.classList.add('end');
    // Setting end text to views
    domElements.counter.textContent = text.counter.end;
    domElements.info.textContent = text.info.complete;
    // Setting end visibility for Action Buttons
    domElements.buttons.pause.hideButton();
    domElements.buttons.restart.showButton();
  };

  const setRemainingText = (stationsLeft) => {
    let stationsLeftText = '';
    // Determine text to be displayed on the stations remaining counter
    // The text is based on the number of stations left
    if (stationsLeft === 0) {
      stationsLeftText = text.remaining.none;
    } else if (stationsLeft === 1) {
      stationsLeftText = text.remaining.single;
    } else {
      // Concatenate the word form of the number of stations left with the text
      stationsLeftText = toSentenceCase(numberToWords.toWords(stationsLeft));
      stationsLeftText += text.remaining.multiple;
    }
    // Set the calculated text to the stations remaining counter view
    domElements.remaining.textContent = stationsLeftText;
  };

  const countdownAction = async () => {
    await durationCountdown();
    await breakDurationCountdown();
  };

  (async () => {
    resetTimer();
    for (let stationsLeft = numRepeats; stationsLeft > 0; stationsLeft -= 1) {
      setRemainingText(stationsLeft);
      // Since we do not want the loop to continue until the cooldown promise is resolved,
      // we wait for the asynchronous code to complete before moving on to the next iteration
      await countdownAction(); // eslint-disable-line no-await-in-loop
      // This is called here to update the counter text before the loop is broken
      setRemainingText(stationsLeft - 1);
    }
    endTimer();
  })();
});
