(() => {
  const fieldDefinitions = [
    { role: "time", label: "Час на вправу", optional: false },
    { role: "inhale", label: "Тривалість вдиху", optional: false },
    { role: "pause", label: "Тривалість паузи", optional: true },
    { role: "exhale", label: "Тривалість видиху", optional: false }
  ];
  const initializedWidgets = new WeakSet();
  let nextWidgetId = 0;

  function createUniqueId(prefix) {
    let id;
    do {
      nextWidgetId += 1;
      id = `${prefix}-${nextWidgetId}`;
    } while (document.getElementById(id));
    return id;
  }

  function requireElement(root, selector, ElementType) {
    const element = root.querySelector(selector);
    if (!(element instanceof ElementType)) {
      throw new Error(`Breathing widget is missing ${selector}.`);
    }
    return element;
  }

  function initializeWidget(root) {
    if (!(root instanceof HTMLElement)) {
      throw new Error("Breathing widget root must be an HTML element.");
    }
    if (initializedWidgets.has(root)) {
      return;
    }

    const fields = fieldDefinitions.map((field) => ({
      ...field,
      input: requireElement(root, `[data-breath-role="${field.role}"]`, HTMLInputElement),
      fieldError: requireElement(root, `[data-breath-role="error-${field.role}"]`, HTMLElement)
    }));
    const settings = requireElement(root, '[data-breath-role="settings"]', HTMLFieldSetElement);
    const cycleOutput = requireElement(root, '[data-breath-role="cycle"]', HTMLOutputElement);
    const cyclesOutput = requireElement(root, '[data-breath-role="cycles"]', HTMLOutputElement);
    const remainingOutput = requireElement(root, '[data-breath-role="remaining"]', HTMLOutputElement);
    const resultPrompt = requireElement(root, '[data-breath-role="result-prompt"]', HTMLElement);
    const errorMessage = requireElement(root, '[data-breath-role="errors"]', HTMLElement);
    const calculationAnnouncement = requireElement(root, '[data-breath-role="calculation-announcement"]', HTMLElement);
    const timerPhase = requireElement(root, '[data-breath-role="timer-phase"]', HTMLElement);
    const timerPhaseCount = requireElement(root, '[data-breath-role="timer-phase-count"]', HTMLElement);
    const timerPhaseHint = requireElement(root, '[data-breath-role="timer-phase-hint"]', HTMLElement);
    const timerRemaining = requireElement(root, '[data-breath-role="timer-remaining"]', HTMLOutputElement);
    const timerStatus = requireElement(root, '[data-breath-role="timer-status"]', HTMLElement);
    const timerToggle = requireElement(root, '[data-breath-role="timer-toggle"]', HTMLButtonElement);
    const timerToggleIcon = requireElement(root, '[data-breath-role="timer-toggle-icon"]', HTMLElement);
    const timerToggleLabel = requireElement(root, '[data-breath-role="timer-toggle-label"]', HTMLElement);
    const timerReset = requireElement(root, '[data-breath-role="timer-reset"]', HTMLButtonElement);

    fields.forEach(({ fieldError }) => {
      fieldError.id = createUniqueId("breath-widget-field-error");
    });

    initializedWidgets.add(root);

    let currentConfig;
    let timerState = "idle";
    let timerInterval;
    let announcementTimeout;
    let intervalStartedAt = 0;
    let elapsedBeforeInterval = 0;
    let sessionDurationSeconds = 0;
    let activePhases = [];
    let activeCycleSeconds = 0;

    function formatTime(totalSeconds) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    function formatCycleCount(count) {
      const lastTwoDigits = count % 100;
      const lastDigit = count % 10;

      if (lastDigit === 1 && lastTwoDigits !== 11) {
        return `${count} повний цикл`;
      }
      if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
        return `${count} повні цикли`;
      }
      return `${count} повних циклів`;
    }

    function formatSeconds(seconds) {
      const lastTwoDigits = seconds % 100;
      const lastDigit = seconds % 10;

      if (lastDigit === 1 && lastTwoDigits !== 11) {
        return `${seconds} секунда`;
      }
      if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
        return `${seconds} секунди`;
      }
      return `${seconds} секунд`;
    }

    function setToggleButton(label, iconClass, pressed) {
      timerToggleLabel.textContent = label;
      timerToggleIcon.className = iconClass;
      timerToggle.setAttribute("aria-pressed", String(pressed));
      timerToggle.disabled = false;
    }

    function linkErrorToField(input, errorId) {
      const describedBy = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (!describedBy.includes(errorId)) {
        describedBy.push(errorId);
        input.setAttribute("aria-describedby", describedBy.join(" "));
      }
    }

    function unlinkErrorFromField(input, errorId) {
      const describedBy = (input.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (describedBy.length > 0) {
        input.setAttribute("aria-describedby", describedBy.join(" "));
      } else {
        input.removeAttribute("aria-describedby");
      }
    }

    function readField(field) {
      const { input, label, optional, fieldError } = field;
      const rawValue = input.value.trim();
      if (rawValue === "" && optional) {
        input.setAttribute("aria-invalid", "false");
        fieldError.textContent = "";
        unlinkErrorFromField(input, fieldError.id);
        return { value: 0, error: "" };
      }

      if (rawValue === "" || input.validity.badInput) {
        input.setAttribute("aria-invalid", "true");
        const error = `${label}: введи ціле число.`;
        fieldError.textContent = error;
        linkErrorToField(input, fieldError.id);
        return { value: null, error };
      }

      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) {
        input.setAttribute("aria-invalid", "true");
        const error = `${label}: введи коректне число.`;
        fieldError.textContent = error;
        linkErrorToField(input, fieldError.id);
        return { value: null, error };
      }

      if (!Number.isInteger(value)) {
        input.setAttribute("aria-invalid", "true");
        const error = `${label}: використовуй ціле число.`;
        fieldError.textContent = error;
        linkErrorToField(input, fieldError.id);
        return { value: null, error };
      }

      const min = Number(input.min);
      const max = Number(input.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || value < min || value > max) {
        input.setAttribute("aria-invalid", "true");
        const error = `${label}: значення має бути від ${min} до ${max}.`;
        fieldError.textContent = error;
        linkErrorToField(input, fieldError.id);
        return { value: null, error };
      }

      input.setAttribute("aria-invalid", "false");
      fieldError.textContent = "";
      unlinkErrorFromField(input, fieldError.id);
      return { value, error: "" };
    }

    function updateCalculator() {
      const results = fields.map(readField);
      const errors = results.map(({ error }) => error).filter(Boolean);

      if (errors.length > 0) {
        window.clearTimeout(announcementTimeout);
        announcementTimeout = undefined;
        calculationAnnouncement.textContent = "";
        currentConfig = undefined;
        cycleOutput.textContent = "—";
        cyclesOutput.textContent = "—";
        remainingOutput.textContent = "—";
        resultPrompt.textContent = "Перевір введені значення.";
        errorMessage.textContent = errors.map((error) => `• ${error}`).join("\n");
        errorMessage.hidden = false;
        timerRemaining.textContent = "—:—";
        timerStatus.textContent = "Виправ поля, щоб запустити вправу.";
        timerPhase.textContent = "Перевір налаштування";
        timerPhaseCount.textContent = "";
        timerPhaseCount.hidden = true;
        timerPhaseHint.textContent = "";
        timerPhaseHint.hidden = true;
        timerToggle.disabled = true;
        return;
      }

      const [minutes, inhale, pause, exhale] = results.map(({ value }) => value);
      const durationSeconds = minutes * 60;
      const cycleSeconds = inhale + pause + exhale;

      if (!Number.isFinite(durationSeconds) || !Number.isFinite(cycleSeconds) || cycleSeconds <= 0) {
        window.clearTimeout(announcementTimeout);
        announcementTimeout = undefined;
        calculationAnnouncement.textContent = "";
        currentConfig = undefined;
        cycleOutput.textContent = "—";
        cyclesOutput.textContent = "—";
        remainingOutput.textContent = "—";
        resultPrompt.textContent = "Не вдалося виконати розрахунок. Перевір параметри.";
        errorMessage.textContent = "Введені значення не дають змоги обчислити тривалість циклу.";
        errorMessage.hidden = false;
        timerRemaining.textContent = "—:—";
        timerStatus.textContent = "Перевір параметри перед запуском.";
        timerPhase.textContent = "Перевір налаштування";
        timerPhaseCount.textContent = "";
        timerPhaseCount.hidden = true;
        timerPhaseHint.textContent = "";
        timerPhaseHint.hidden = true;
        timerToggle.disabled = true;
        return;
      }

      currentConfig = { minutes, inhale, pause, exhale, durationSeconds, cycleSeconds };
      errorMessage.textContent = "";
      errorMessage.hidden = true;

      const cycles = Math.floor(durationSeconds / cycleSeconds);
      const remainingSeconds = durationSeconds - cycles * cycleSeconds;
      cycleOutput.textContent = String(cycleSeconds);
      cyclesOutput.textContent = String(cycles);
      remainingOutput.textContent = String(remainingSeconds);
      resultPrompt.textContent = `У вибраний час поміщається ${formatCycleCount(cycles)}.`;

      if (timerState === "idle") {
        timerRemaining.textContent = formatTime(durationSeconds);
        timerStatus.textContent = "Таймер запуститься з обраними налаштуваннями.";
        timerPhase.textContent = "Готово";
        timerPhaseCount.textContent = "";
        timerPhaseCount.hidden = true;
        timerPhaseHint.textContent = "";
        timerPhaseHint.hidden = true;
        timerToggle.disabled = false;
      }
    }

    function scheduleCalculationAnnouncement() {
      window.clearTimeout(announcementTimeout);
      calculationAnnouncement.textContent = "";
      if (!currentConfig) {
        return;
      }

      announcementTimeout = window.setTimeout(() => {
        const cycles = Math.floor(currentConfig.durationSeconds / currentConfig.cycleSeconds);
        const remainingSeconds = currentConfig.durationSeconds - cycles * currentConfig.cycleSeconds;
        calculationAnnouncement.textContent =
          `Один цикл: ${formatSeconds(currentConfig.cycleSeconds)}. ` +
          `Повних циклів: ${cycles}. Залишок: ${formatSeconds(remainingSeconds)}.`;
      }, 500);
    }

    function getActivePhases(config) {
      return [
        { label: "Вдих", seconds: config.inhale, hint: "М'яко вдихни" },
        { label: "Пауза", seconds: config.pause, hint: "Лише якщо пауза комфортна" },
        { label: "Видих", seconds: config.exhale, hint: "Повільно видихни" }
      ].filter((phase) => phase.seconds > 0);
    }

    function getElapsedSeconds() {
      if (timerState === "running") {
        return elapsedBeforeInterval + (Date.now() - intervalStartedAt) / 1000;
      }
      return elapsedBeforeInterval;
    }

    function finishTimer() {
      window.clearInterval(timerInterval);
      timerInterval = undefined;
      timerState = "completed";
      elapsedBeforeInterval = sessionDurationSeconds;
      settings.disabled = false;
      timerRemaining.textContent = "00:00";
      timerPhase.textContent = "Вправу завершено";
      timerPhaseCount.textContent = "✓";
      timerPhaseHint.textContent = "Можеш повторити або змінити налаштування.";
      timerPhaseCount.hidden = false;
      timerPhaseHint.hidden = false;
      timerStatus.textContent = "Вправу завершено.";
      setToggleButton("Повторити вправу", "fa-solid fa-rotate-right", false);
      timerReset.disabled = false;
    }

    function updateTimerDisplay() {
      const elapsedSeconds = getElapsedSeconds();
      if (elapsedSeconds >= sessionDurationSeconds) {
        finishTimer();
        return;
      }

      timerRemaining.textContent = formatTime(Math.ceil(sessionDurationSeconds - elapsedSeconds));

      let phaseElapsedSeconds = elapsedSeconds % activeCycleSeconds;
      const phase = activePhases.find((item) => {
        if (phaseElapsedSeconds < item.seconds) {
          return true;
        }
        phaseElapsedSeconds -= item.seconds;
        return false;
      });

      if (!phase) {
        throw new Error("Breathing timer could not determine the current phase.");
      }

      timerPhase.textContent = phase.label;
      timerPhaseCount.textContent = String(Math.max(1, Math.ceil(phase.seconds - phaseElapsedSeconds)));
      timerPhaseHint.textContent = phase.hint;
      timerPhaseCount.hidden = false;
      timerPhaseHint.hidden = false;
    }

    function startTimer() {
      if (!currentConfig) {
        updateCalculator();
        return;
      }

      window.clearTimeout(announcementTimeout);
      announcementTimeout = undefined;
      calculationAnnouncement.textContent = "";
      sessionDurationSeconds = currentConfig.durationSeconds;
      activeCycleSeconds = currentConfig.cycleSeconds;
      activePhases = getActivePhases(currentConfig);
      elapsedBeforeInterval = 0;
      intervalStartedAt = Date.now();
      timerState = "running";
      settings.disabled = true;
      timerReset.disabled = false;
      timerStatus.textContent = "Вправа триває. Можеш натиснути «Пауза» будь-коли.";
      setToggleButton("Пауза", "fa-solid fa-pause", true);
      updateTimerDisplay();
      timerInterval = window.setInterval(updateTimerDisplay, 250);
    }

    function pauseTimer() {
      elapsedBeforeInterval += (Date.now() - intervalStartedAt) / 1000;
      window.clearInterval(timerInterval);
      timerInterval = undefined;
      timerState = "paused";
      timerStatus.textContent = "Таймер призупинено.";
      setToggleButton("Продовжити", "fa-solid fa-play", false);
      updateTimerDisplay();
    }

    function resumeTimer() {
      intervalStartedAt = Date.now();
      timerState = "running";
      timerStatus.textContent = "Вправа триває. Можеш натиснути «Пауза» будь-коли.";
      setToggleButton("Пауза", "fa-solid fa-pause", true);
      updateTimerDisplay();
      timerInterval = window.setInterval(updateTimerDisplay, 250);
    }

    function resetTimer() {
      window.clearInterval(timerInterval);
      timerInterval = undefined;
      timerState = "idle";
      elapsedBeforeInterval = 0;
      sessionDurationSeconds = 0;
      activePhases = [];
      activeCycleSeconds = 0;
      settings.disabled = false;
      timerPhase.textContent = "Готово";
      timerPhaseCount.textContent = "";
      timerPhaseCount.hidden = true;
      timerPhaseHint.textContent = "";
      timerPhaseHint.hidden = true;
      setToggleButton("Почати вправу", "fa-solid fa-play", false);
      timerReset.disabled = true;
      updateCalculator();
    }

    function handleSettingsChange() {
      if (timerState === "running" || timerState === "paused") {
        return;
      }

      if (timerState === "completed") {
        timerState = "idle";
        elapsedBeforeInterval = 0;
        timerPhase.textContent = "Готово";
        timerPhaseCount.textContent = "";
        timerPhaseCount.hidden = true;
        timerPhaseHint.textContent = "";
        timerPhaseHint.hidden = true;
        setToggleButton("Почати вправу", "fa-solid fa-play", false);
        timerReset.disabled = true;
      }

      updateCalculator();
      scheduleCalculationAnnouncement();
    }

    fields.forEach(({ input }) => {
      input.addEventListener("input", handleSettingsChange);
      input.addEventListener("change", handleSettingsChange);
    });

    timerToggle.addEventListener("click", () => {
      if (timerState === "running") {
        pauseTimer();
      } else if (timerState === "paused") {
        resumeTimer();
      } else {
        startTimer();
      }
    });

    timerReset.addEventListener("click", resetTimer);

    updateCalculator();
  }

  document.querySelectorAll("[data-breath-widget]").forEach(initializeWidget);
})();
