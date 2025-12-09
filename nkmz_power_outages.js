// nkmz_power_outages.js
// Версия под power_stats_all_years.json (структура: { "years": { "2015": {...}, ... } })

(function () {
  const DATA_URL = "power_stats_all_years.json";
  const LAST_UPDATE_FILE = "last_update.txt";

  const YEARS_START = 2015;
  const YEARS_END = 2030;

  let rawAllData = null;

  // yearNumber -> { dayMap, yearStats, monthStats }
  let allYears = {};
  let availableYears = [];

  let currentYear = null;    // 2015..2030
  let currentMonth = null;   // 1..12
  let currentDayKey = null;  // "YYYY-MM-DD"

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    // 1) сразу подтягиваем время последнего экспорта из last_update.txt
    loadLastUpdateLabel();

    // 2) как и раньше — грузим JSON с интервалами
    fetch(DATA_URL)
      .then((resp) => resp.json())
      .then((data) => {
        rawAllData = data;
        prepareDataFromAllYears();
        renderAll();
        setupTimelineHover();
      })
      .catch((err) => {
        console.error("Ошибка загрузки данных", err);
        showError(
          'Не удалось загрузить данные. Проверьте файл "power_stats_all_years.json".'
        );
      });
  }

  function showError(msg) {
    const yearStatsEl = document.getElementById("year-stats");
    if (yearStatsEl) yearStatsEl.textContent = msg;
  }

  function loadLastUpdateLabel() {
    const span = document.getElementById("last-updated");
    if (!span) return;

    fetch(LAST_UPDATE_FILE)
      .then((resp) => {
        if (!resp.ok) {
          throw new Error("HTTP " + resp.status);
        }
        return resp.text();
      })
      .then((text) => {
        const m = text.match(
          /(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(:\d{2})?(?:[.,]\d+)?)\s*$/
        );
        if (m) {
          span.textContent = m[1].replace(",", ".");
        } else {
          span.textContent = text.trim();
        }
      })
      .catch((err) => {
        console.warn("Не удалось прочитать last_update.txt:", err);
        span.textContent = "нет данных";
      });
  }

  function prepareDataFromAllYears() {
    if (!rawAllData || !rawAllData.years) {
      showError('В файле нет раздела "years".');
      return;
    }

    allYears = {};
    availableYears = [];

    for (const [yearStr, yearRaw] of Object.entries(rawAllData.years)) {
      const yearNum = parseInt(yearStr, 10);
      if (!yearRaw || !yearRaw.days) continue;

      const perYear = buildYearData(yearNum, yearRaw);
      allYears[yearNum] = perYear;
      availableYears.push(yearNum);
    }

    availableYears.sort((a, b) => a - b);

    if (availableYears.length === 0) {
      currentYear = new Date().getFullYear();
      currentMonth = null;
      currentDayKey = null;
      return;
    }

    currentYear = availableYears[availableYears.length - 1];
    determineDefaultMonthAndDayForCurrentYear();
  }
function buildYearData(year, yearRaw) {
    const dayMap = {};
    const daysRaw = yearRaw.days || {};

    let totalMinutes = 0;
    let totalOutages = 0;
    let daysWithOutages = 0;

    const monthStats = {};

    for (const [dateKey, dayRaw] of Object.entries(daysRaw)) {
      const date = new Date(dateKey + "T00:00:00");
      const rawIntervals = dayRaw.intervals || [];

      let totalMinutesDay = 0;
      const intervals = [];

      for (const iv of rawIntervals) {
        if (!iv.from || !iv.to) continue;
        const start = new Date(iv.from);
        const end = new Date(iv.to);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
          continue;
        }
        const minutes = (end - start) / 60000;
        intervals.push({ start, end, minutes });
        totalMinutesDay += minutes;
      }

      const startEvents = dayRaw.outage_count || 0;

      dayMap[dateKey] = {
        date,
        intervals,
        totalMinutes: totalMinutesDay,
        startEvents,
      };

      if (totalMinutesDay > 0) {
        daysWithOutages += 1;
        totalMinutes += totalMinutesDay;
      }

      totalOutages += startEvents;

      const m = date.getMonth() + 1;
      if (!monthStats[m]) {
        monthStats[m] = {
          outageCount: 0,
          totalMinutes: 0,
          daysWithOutages: 0,
        };
      }

      monthStats[m].totalMinutes += totalMinutesDay;
      if (totalMinutesDay > 0) {
        monthStats[m].daysWithOutages += 1;
      }
      monthStats[m].outageCount += startEvents;
    }

    const yearStats = {
      totalOutages,
      totalMinutes,
      daysWithOutages,
    };

    return { dayMap, yearStats, monthStats };
  }

  function determineDefaultMonthAndDayForCurrentYear() {
    const dm = getDayMap();
    let lastDate = null;
    let lastKey = null;

    for (const [key, dayInfo] of Object.entries(dm)) {
      if (dayInfo.totalMinutes <= 0) continue;
      if (!lastDate || dayInfo.date > lastDate) {
        lastDate = dayInfo.date;
        lastKey = key;
      }
    }

    if (lastDate) {
      currentMonth = lastDate.getMonth() + 1;
      currentDayKey = lastKey;
    } else {
      currentMonth = 1;
      currentDayKey = null;
    }
  }

  function getCurrentYearData() {
    if (!allYears[currentYear]) {
      return {
        dayMap: {},
        yearStats: { totalOutages: 0, totalMinutes: 0, daysWithOutages: 0 },
        monthStats: {},
      };
    }
    return allYears[currentYear];
  }

  function getDayMap() {
    return getCurrentYearData().dayMap;
  }

  function getMonthStats() {
    return getCurrentYearData().monthStats;
  }

  function getYearStats() {
    return getCurrentYearData().yearStats;
  }

  // ==== РЕНДЕР ====

  function renderAll() {
    renderYearStrip();
    renderYearSummary();
    renderMonths();
    renderCalendar();
    renderHistogram();  // ДОБАВЛЕНО: рендер гистограммы
    renderDayDetail();
  }

  function renderYearStrip() {
    const strip = document.getElementById("year-strip");
    if (!strip) return;
    strip.innerHTML = "";

    const maxYearWithData =
      availableYears.length > 0 ? availableYears[availableYears.length - 1] : null;

    for (const y of availableYears) {
      const pill = document.createElement("div");
      pill.classList.add("year-pill");
      pill.dataset.year = String(y);

      const label = document.createElement("span");
      label.classList.add("year-label");
      label.textContent = String(y);
      pill.appendChild(label);

      const meta = document.createElement("span");
      meta.classList.add("year-meta");

if (allYears[y]) {
        const ys = allYears[y].yearStats;
        const hoursText = formatHoursShort(ys.totalMinutes) + " ч";
        meta.textContent =
          `${formatAccidentPhrase(ys.totalOutages)} · ${hoursText}`;
        
        if (ys.totalMinutes > 0 || ys.totalOutages > 0) {
          pill.classList.add("has-outages");
        }
        
        if (y === currentYear) pill.classList.add("active");
        pill.addEventListener("click", () => onYearSelected(y));
        
// Hover эффект - золотая рамка если есть отключения
        if (ys.totalMinutes > 0 || ys.totalOutages > 0) {
          pill.addEventListener("mouseenter", () => {
            if (y !== currentYear) {
              pill.style.borderColor = "#ffca6b";
              pill.style.boxShadow = "0 0 0 1px rgba(255, 202, 107, 0.7)";
            }
          });
          pill.addEventListener("mouseleave", () => {
            if (y !== currentYear) {
              pill.style.borderColor = "";
              pill.style.boxShadow = "";
            }
          });
        }
      } else if (maxYearWithData !== null && y > maxYearWithData) {
        pill.classList.add("future");
        meta.textContent = "будущий год";
      } else {
        pill.classList.add("no-data");
        meta.textContent = "нет данных";
      }

      pill.appendChild(meta);
      strip.appendChild(pill);
    }
  }

  function onYearSelected(year) {
    if (!allYears[year]) return;
    if (year === currentYear) return;

    currentYear = year;
    currentMonth = null;
    currentDayKey = null;
    determineDefaultMonthAndDayForCurrentYear();
    updateYearStripActive();
    renderYearSummary();
    renderMonths();
    renderCalendar();
    renderHistogram();  // ДОБАВЛЕНО
    renderDayDetail();
  }

  function updateYearStripActive() {
    const pills = document.querySelectorAll(".year-pill");
    pills.forEach((pill) => {
      const y = Number(pill.dataset.year);
      if (y === currentYear) {
        pill.classList.add("active");
      } else {
        pill.classList.remove("active");
      }
    });
  }

  function renderYearSummary() {
    const yearTitle = document.getElementById("year-title");
    const yearStatsEl = document.getElementById("year-stats");
    if (!yearTitle || !yearStatsEl) return;

    if (!currentYear || !allYears[currentYear]) {
      yearTitle.textContent = "Год";
      yearStatsEl.textContent = "Нет данных по выбранному году.";
      return;
    }

    const ys = getYearStats();

    yearTitle.textContent = `${currentYear} год`;

    const hours = ys.totalMinutes / 60;
    yearStatsEl.textContent =
      `${formatAccidentPhrase(ys.totalOutages)} · ` +
      `Дней с отключениями: ${ys.daysWithOutages} · ` +
      `Без питания: ${hours.toFixed(1)} ч`;
  }
function renderMonths() {
    const strip = document.getElementById("month-strip");
    if (!strip) return;
    strip.innerHTML = "";

    const monthStats = getMonthStats();

    const monthNames = [
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ];

    for (let m = 1; m <= 12; m++) {
      const card = document.createElement("div");
      card.classList.add("month-card");
      card.dataset.month = String(m);

      const nameEl = document.createElement("div");
      nameEl.classList.add("month-name");
      nameEl.textContent = monthNames[m - 1];
      card.appendChild(nameEl);

      const metaEl = document.createElement("div");
      metaEl.classList.add("month-meta");

      const ms = monthStats[m];
      if (ms && ms.totalMinutes > 0) {
        const hoursText = formatHoursShort(ms.totalMinutes) + " ч";
        metaEl.textContent =
          `${formatAccidentPhrase(ms.outageCount)} · ${hoursText}`;
        metaEl.classList.add("alert");
      } else {
        metaEl.textContent = "нет отключений";
        card.classList.add("no-data");
      }

      card.appendChild(metaEl);

      if (currentMonth === m) {
        card.classList.add("active");
      }

      card.addEventListener("click", () => {
        onMonthSelected(m);
      });

      strip.appendChild(card);
    }
  }

  function onMonthSelected(m) {
    currentMonth = m;

    const dm = getDayMap();
    let candidateKey = null;
    let candidateDate = null;

    for (const [key, dayInfo] of Object.entries(dm)) {
      if (dayInfo.totalMinutes <= 0) continue;
      const monthIndex = dayInfo.date.getMonth() + 1;
      if (monthIndex !== m) continue;
      if (!candidateDate || dayInfo.date > candidateDate) {
        candidateDate = dayInfo.date;
        candidateKey = key;
      }
    }

    currentDayKey = candidateKey;

    updateActiveMonthCard();
    renderCalendar();
    renderHistogram();  // ДОБАВЛЕНО
    renderDayDetail();
  }

  function updateActiveMonthCard() {
    const cards = document.querySelectorAll(".month-card");
    cards.forEach((card) => {
      const m = Number(card.dataset.month);
      if (m === currentMonth) {
        card.classList.add("active");
      } else {
        card.classList.remove("active");
      }
    });
  }

  function renderCalendar() {
    const titleEl = document.getElementById("calendar-title");
    const grid = document.getElementById("calendar-grid");
    if (!grid || !titleEl) return;

    const dm = getDayMap();

    if (!currentMonth) {
      grid.innerHTML = "";
      titleEl.textContent = "Нет данных по месяцам";
      return;
    }

    const dataYear = currentYear;

    const monthNamesRus = [
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ];

    titleEl.textContent = `${monthNamesRus[currentMonth - 1]} ${dataYear} — календарь`;

    grid.innerHTML = "";

    const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    weekdays.forEach((name, idx) => {
      const cell = document.createElement("div");
      cell.classList.add("calendar-weekday");
      if (idx >= 5) cell.classList.add("weekend");
      cell.textContent = name;
      grid.appendChild(cell);
    });

    const firstDate = new Date(dataYear, currentMonth - 1, 1);
    const daysInMonth = new Date(dataYear, currentMonth, 0).getDate();
    const firstWeekdayIndex = (firstDate.getDay() + 6) % 7;

    for (let i = 0; i < firstWeekdayIndex; i++) {
      const emptyCell = document.createElement("div");
      emptyCell.classList.add("calendar-day", "empty");
      grid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(dataYear, currentMonth - 1, day);
      const weekdayIndex = (date.getDay() + 6) % 7;
      const dateKey = formatDateKey(date);
      const dayInfo = dm[dateKey];

      const cell = document.createElement("div");
      cell.classList.add("calendar-day");
      if (weekdayIndex >= 5) cell.classList.add("calendar-day-weekend");

      const numEl = document.createElement("div");
      numEl.classList.add("calendar-day-number");
      numEl.textContent = String(day);
      cell.appendChild(numEl);

      if (dayInfo && dayInfo.totalMinutes > 0) {
        cell.classList.add("has-outage");

        const metaEl = document.createElement("div");
        metaEl.classList.add("calendar-day-meta");

        const hoursText = formatHoursShort(dayInfo.totalMinutes) + " ч";
        if (dayInfo.startEvents > 0) {
          metaEl.textContent =
            `${formatAccidentPhrase(dayInfo.startEvents)} · ${hoursText}`;
        } else {
          metaEl.textContent = `${hoursText} без питания`;
        }
        cell.appendChild(metaEl);

        const miniAxis = document.createElement("div");
        miniAxis.classList.add("calendar-day-mini-axis");
        renderMiniTimelineForDay(dayInfo, miniAxis);
        cell.appendChild(miniAxis);
      }

      if (currentDayKey === dateKey) {
        cell.classList.add("active");
      }

      cell.dataset.dateKey = dateKey;
      cell.addEventListener("click", () => {
        onDaySelected(dateKey);
      });
      // Hover эффект на днях с отключениями
      if (dayInfo && dayInfo.totalMinutes > 0) {
        cell.addEventListener("mouseenter", () => {
          if (currentDayKey !== dateKey) {
            cell.style.borderColor = "rgba(255, 202, 107, 0.7)";
            cell.style.boxShadow = "0 0 0 1px rgba(255, 202, 107, 0.5)";
          }
        });
        cell.addEventListener("mouseleave", () => {
          if (currentDayKey !== dateKey) {
            cell.style.borderColor = "";
            cell.style.boxShadow = "";
          }
        });
      }

      grid.appendChild(cell);
    }
  }

  function onDaySelected(dateKey) {
    currentDayKey = dateKey;

    const cells = document.querySelectorAll(".calendar-day");
    cells.forEach((cell) => {
      if (cell.classList.contains("empty")) return;
      const key = cell.dataset.dateKey;
      if (key === currentDayKey) {
        cell.classList.add("active");
      } else {
        cell.classList.remove("active");
      }
    });

    // ДОБАВЛЕНО: Выделить столбик в гистограмме
    highlightHistogramBar(dateKey);
    
    renderDayDetail();
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }
// ==== ГИСТОГРАММА ДНЕЙ МЕСЯЦА (НОВАЯ ФУНКЦИЯ) ====

// ==== ГИСТОГРАММА ДНЕЙ МЕСЯЦА (НОВАЯ ФУНКЦИЯ) ====

// ==== ГИСТОГРАММА ДНЕЙ МЕСЯЦА (SVG ВЕРСИЯ) ====

  function renderHistogram() {
    const chart = document.getElementById("histogram-chart");
    if (!chart) return;
    chart.innerHTML = "";

    if (!currentMonth) return;

    const dm = getDayMap();
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);

    // Создаём SVG
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "180");
    svg.setAttribute("viewBox", `0 0 ${Math.max(daysInMonth * 30 + 50, 900)} 180`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.display = "block";

    // Рисуем горизонтальные линии и цифры часов (0, 6, 12, 18, 24)
    const scaleLabels = [0, 6, 12, 18, 24];
    scaleLabels.forEach((hour) => {
      const y = 170 - (hour / 24) * 150; // 150 = высота графика, 170 = отступ снизу

      // Линия
      // Линия (будет добавлена ПОСЛЕ столбиков)

      // Цифра
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", "5");
      text.setAttribute("y", y + 4);
      text.setAttribute("fill", "#9ea5b3");
      text.setAttribute("font-size", "10");
      text.setAttribute("font-weight", "500");
      text.textContent = hour;
      svg.appendChild(text);
    });

    // Рисуем столбики для каждого дня
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth - 1, day);
      const dateKey = formatDateKey(date);
      const dayInfo = dm[dateKey];

      const x = 50 + (day - 1) * 30; // позиция по X
      const barWidth = 26; // ширина столбика

      // Группа для столбика (для событий)
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("data-date-key", dateKey);
      group.style.cursor = "pointer";

      // Фон столбика (рамка)
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("x", x);
      bgRect.setAttribute("y", 20);
      bgRect.setAttribute("width", barWidth);
      bgRect.setAttribute("height", 150);
      bgRect.setAttribute("fill", "transparent");
      bgRect.setAttribute("stroke", "transparent");
      bgRect.setAttribute("stroke-width", "2");
      bgRect.setAttribute("rx", "2");
      group.appendChild(bgRect);

      if (dayInfo && dayInfo.intervals && dayInfo.intervals.length > 0) {
        // Есть отключения - строим сегменты
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

        // Создаем массив минут (0-1439) со статусом
        const minuteStatus = new Array(1440).fill(true);

        dayInfo.intervals.forEach((interval) => {
          let start = interval.start < dayStart ? dayStart : interval.start;
          let end = interval.end > dayEnd ? dayEnd : interval.end;

          const startMin = Math.floor((start - dayStart) / 60000);
          const endMin = Math.ceil((end - dayStart) / 60000);

          for (let m = startMin; m < endMin && m < 1440; m++) {
            minuteStatus[m] = false;
          }
        });

        // Собираем непрерывные сегменты
        const segments = [];
        let currentSegment = { start: 0, hasPower: minuteStatus[0] };

        for (let m = 1; m < 1440; m++) {
          if (minuteStatus[m] !== currentSegment.hasPower) {
            segments.push({
              start: currentSegment.start,
              end: m,
              hasPower: currentSegment.hasPower
            });
            currentSegment = { start: m, hasPower: minuteStatus[m] };
          }
        }
        segments.push({
          start: currentSegment.start,
          end: 1440,
          hasPower: currentSegment.hasPower
        });

        // Рендерим сегменты
        let currentY = 170;
        segments.forEach(seg => {
          const durationMinutes = seg.end - seg.start;
          const segmentHeight = (durationMinutes / 1440) * 150;

          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", x);
          rect.setAttribute("y", currentY - segmentHeight);
          rect.setAttribute("width", barWidth);
          rect.setAttribute("height", segmentHeight);
          rect.setAttribute("fill", seg.hasPower ? "#2e7d32" : "#d84315");
          group.appendChild(rect);

          currentY -= segmentHeight;
        });

      } else {
        // Нет отключений - полностью зелёный
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", 20);
        rect.setAttribute("width", barWidth);
        rect.setAttribute("height", 150);
        rect.setAttribute("fill", "#2e7d32");
        group.appendChild(rect);
      }

// Если выходной - пишем СБ/ВС НАД столбиком справа
      const dayOfWeek = date.getDay(); // 0=вс, 6=сб
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const weekendText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        weekendText.setAttribute("x", x + barWidth - 2);
        weekendText.setAttribute("y", 15);
        weekendText.setAttribute("fill", "#ffb74d");
        weekendText.setAttribute("font-size", "9");
        weekendText.setAttribute("font-weight", "600");
        weekendText.setAttribute("text-anchor", "end");
        weekendText.textContent = dayOfWeek === 0 ? "ВС" : "СБ";
        group.appendChild(weekendText);
      }
      
      // Число дня слева вверху
      const dayText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      dayText.setAttribute("x", x + 3);
      dayText.setAttribute("y", 30);
      dayText.setAttribute("fill", "#f5f5f5");
      dayText.setAttribute("font-size", "10");
      dayText.setAttribute("font-weight", "500");
      dayText.style.textShadow = "0 0 3px rgba(0,0,0,0.8)";
      dayText.textContent = String(day);
      group.appendChild(dayText);

      // Выделение если текущий день
      if (currentDayKey === dateKey) {
        bgRect.setAttribute("stroke", "#ffca6b");
        bgRect.setAttribute("stroke-width", "2");
      }

      // Tooltip (создаём foreignObject для HTML tooltip)
      const tooltip = document.createElement("div");
      tooltip.style.position = "absolute";
      tooltip.style.padding = "4px 8px";
      tooltip.style.background = "rgba(0, 0, 0, 0.9)";
      tooltip.style.borderRadius = "4px";
      tooltip.style.fontSize = "11px";
      tooltip.style.color = "#f5f5f5";
      tooltip.style.pointerEvents = "none";
      tooltip.style.opacity = "0";
      tooltip.style.transition = "opacity 0.2s";
      tooltip.style.zIndex = "1000";
      tooltip.style.whiteSpace = "nowrap";
      
      const hours = dayInfo ? (dayInfo.totalMinutes / 60).toFixed(1) : "0.0";
      tooltip.textContent = `${hours} ч без питания`;
      chart.appendChild(tooltip);

      // События hover
        group.addEventListener("mouseenter", (e) => {
        bgRect.setAttribute("opacity", "0.8");
        const rect = chart.getBoundingClientRect();
        const groupRect = group.getBoundingClientRect();
        tooltip.style.left = (groupRect.left - rect.left + barWidth / 2) + "px";
        tooltip.style.top = (groupRect.bottom - rect.top + 8) + "px";
        tooltip.style.transform = "translateX(-50%)";
        tooltip.style.opacity = "1";
      });

      group.addEventListener("mouseleave", () => {
        bgRect.setAttribute("opacity", "1");
        tooltip.style.opacity = "0";
      });

      // Клик по столбику
// Клик по столбику
      group.addEventListener("click", () => {
        if (dm[dateKey]) {
          currentDayKey = dateKey;
          
          // Выделяем день в календаре
          const cells = document.querySelectorAll(".calendar-day");
          cells.forEach((cell) => {
            if (cell.classList.contains("empty")) return;
            const key = cell.dataset.dateKey;
            if (key === dateKey) {
              cell.classList.add("active");
            } else {
              cell.classList.remove("active");
            }
          });
          
          // Выделяем столбик в гистограмме
          highlightHistogramBar(dateKey);
          
          // Показываем детализацию
          renderDayDetail();
        }
      });

      svg.appendChild(group);
    }
// Рисуем линии ПОВЕРХ столбиков
    scaleLabels.forEach((hour) => {
      const y = 170 - (hour / 24) * 150;
      
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "40");
      line.setAttribute("y1", y);
      line.setAttribute("x2", "100%");
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "rgba(255, 255, 255, 0.3)");
      line.setAttribute("stroke-width", "1");
      line.style.pointerEvents = "none";
      svg.appendChild(line);
    });
    chart.appendChild(svg);
  }

  // ДОБАВЛЕНО: Функция выделения столбика в гистограмме
function highlightHistogramBar(dateKey) {
  const chart = document.getElementById("histogram-chart");
  if (!chart) return;
  
  const groups = chart.querySelectorAll("g[data-date-key]");
  groups.forEach((group) => {
    const rect = group.querySelector("rect"); // первый rect = фон с рамкой
    const key = group.getAttribute("data-date-key");
    
    if (key === dateKey) {
      rect.setAttribute("stroke", "#ffca6b");
      rect.setAttribute("stroke-width", "2");
    } else {
      rect.setAttribute("stroke", "transparent");
      rect.setAttribute("stroke-width", "2");
    }
  });
}

function renderDayDetail() {
    const titleEl = document.getElementById("day-title");
    const summaryEl = document.getElementById("day-summary");
    const noteEl = document.querySelector(".day-timeline-note");
    const hoverEl = document.getElementById("day-timeline-hover");
    if (!titleEl || !summaryEl) return;

    const dm = getDayMap();

    if (!currentDayKey || !dm[currentDayKey]) {
      titleEl.textContent = "Детализация дня отсутствует";
      summaryEl.textContent = "Выберите день с отключениями в календаре.";
      renderTimeline(null);
      if (noteEl) {
        noteEl.textContent =
          "Зелёная полоса — время с питанием. Красные сегменты появятся при выборе дня с отключениями.";
      }
      if (hoverEl) {
        hoverEl.textContent =
          "Наведите курсор на шкалу, чтобы увидеть точное время и состояние.";
      }
      return;
    }

    const dayInfo = dm[currentDayKey];
    const date = dayInfo.date;
    const weekdayName = getWeekdayName(date);

    titleEl.textContent =
      `Детализация дня: ${formatDateHuman(date)} (${weekdayName})`;

    const fm = formatHoursMinutes(dayInfo.totalMinutes);
    const starts = dayInfo.startEvents || 0;
    summaryEl.textContent =
      `${formatAccidentPhrase(starts)} · Время без питания: ${fm}`;

    if (hoverEl) {
      hoverEl.textContent =
        "Наведите курсор на шкалу, чтобы увидеть точное время и состояние.";
    }

    renderTimeline(dayInfo);

    if (noteEl) {
      noteEl.textContent =
        "Зелёная полоса — время с питанием. Красные сегменты показывают интервалы отключений за выбранный день.";
    }
  }

  function renderTimeline(dayInfo) {
    const axisEl = document.getElementById("day-timeline-axis");
    const marksEl = document.getElementById("day-timeline-hour-marks");
    if (!axisEl || !marksEl) return;

    const oldSegments = axisEl.querySelectorAll(".day-timeline-outage");
    oldSegments.forEach((seg) => seg.remove());
    marksEl.innerHTML = "";

    // отметки по часам
    for (let h = 0; h <= 24; h++) {
      const mark = document.createElement("div");
      mark.classList.add("day-timeline-hour-mark");
      const left = (h * 60 / 1440) * 100;
      mark.style.left = left + "%";
      marksEl.appendChild(mark);
    }

    if (!dayInfo || !dayInfo.intervals || dayInfo.intervals.length === 0) {
      return;
    }

    const dayStart = new Date(
      dayInfo.date.getFullYear(),
      dayInfo.date.getMonth(),
      dayInfo.date.getDate()
    );
    const dayEnd = new Date(
      dayInfo.date.getFullYear(),
      dayInfo.date.getMonth(),
      dayInfo.date.getDate() + 1
    );

    dayInfo.intervals.forEach((interval) => {
      let start = interval.start;
      let end = interval.end;

      if (end <= start) return;

      if (start < dayStart) start = dayStart;
      if (end > dayEnd) end = dayEnd;

      const startMin = (start - dayStart) / 60000;
      const endMin = (end - dayStart) / 60000;

      if (endMin <= startMin) return;

      const div = document.createElement("div");
      div.classList.add("day-timeline-outage");
      const left = (startMin / 1440) * 100;
      const width = ((endMin - startMin) / 1440) * 100;
      div.style.left = left + "%";
      div.style.width = width + "%";
      axisEl.appendChild(div);
    });
  }

  function setupTimelineHover() {
    const axisEl = document.getElementById("day-timeline-axis");
    const hoverEl = document.getElementById("day-timeline-hover");
    if (!axisEl || !hoverEl) return;

    axisEl.addEventListener("mousemove", (event) => {
      const dm = getDayMap();

      if (!currentDayKey || !dm[currentDayKey]) {
        hoverEl.textContent = "Нет данных для выбранного дня.";
        return;
      }

      const rect = axisEl.getBoundingClientRect();
      if (rect.width <= 0) return;

      const x = event.clientX - rect.left;
      let fraction = x / rect.width;
      if (fraction < 0) fraction = 0;
      if (fraction > 1) fraction = 1;

      const minutesFromStart = fraction * 1440;
      const totalMinutes = Math.floor(minutesFromStart);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      const timeStr =
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

      const dayInfo = dm[currentDayKey];
      const dayStart = new Date(
        dayInfo.date.getFullYear(),
        dayInfo.date.getMonth(),
        dayInfo.date.getDate()
      );
      const dayEnd = new Date(
        dayInfo.date.getFullYear(),
        dayInfo.date.getMonth(),
        dayInfo.date.getDate() + 1
      );
      const cursorTime = new Date(dayStart.getTime() + totalMinutes * 60000);

      let inOutage = false;
      if (dayInfo.intervals && dayInfo.intervals.length > 0) {
        for (const interval of dayInfo.intervals) {
          let s = interval.start < dayStart ? dayStart : interval.start;
          let e = interval.end > dayEnd ? dayEnd : interval.end;
          if (cursorTime >= s && cursorTime <= e) {
            inOutage = true;
            break;
          }
        }
      }

      hoverEl.textContent =
        `Время: ${timeStr} · ${inOutage ? "без питания" : "питание есть"}`;
    });

    axisEl.addEventListener("mouseleave", () => {
      hoverEl.textContent =
        "Наведите курсор на шкалу, чтобы увидеть точное время и состояние.";
    });
  }

  function renderMiniTimelineForDay(dayInfo, container) {
    container.innerHTML = "";

    const base = document.createElement("div");
    base.classList.add("calendar-day-mini-base");
    container.appendChild(base);

    if (!dayInfo || !dayInfo.intervals || dayInfo.intervals.length === 0) {
      return;
    }

    const dayStart = new Date(
      dayInfo.date.getFullYear(),
      dayInfo.date.getMonth(),
      dayInfo.date.getDate()
    );
    const dayEnd = new Date(
      dayInfo.date.getFullYear(),
      dayInfo.date.getMonth(),
      dayInfo.date.getDate() + 1
    );

    dayInfo.intervals.forEach((interval) => {
      let start = interval.start;
      let end = interval.end;
      if (end <= start) return;

      if (start < dayStart) start = dayStart;
      if (end > dayEnd) end = dayEnd;

      const startMin = (start - dayStart) / 60000;
      const endMin = (end - dayStart) / 60000;
      if (endMin <= startMin) return;

      const seg = document.createElement("div");
      seg.classList.add("calendar-day-mini-outage");
      const left = (startMin / 1440) * 100;
      const width = ((endMin - startMin) / 1440) * 100;
      seg.style.left = left + "%";
      seg.style.width = width + "%";
      container.appendChild(seg);
    });
  }
// ==== УТИЛИТЫ ====

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDateHuman(date) {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
  }

  function getWeekdayName(date) {
    const names = [
      "понедельник",
      "вторник",
      "среда",
      "четверг",
      "пятница",
      "суббота",
      "воскресенье",
    ];
    const idx = (date.getDay() + 6) % 7;
    return names[idx];
  }

  function formatHoursShort(totalMinutes) {
    const hours = totalMinutes / 60;
    return hours.toFixed(1).replace(".", ",");
  }

  function formatHoursMinutes(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h} ч ${m} мин`;
    if (h > 0) return `${h} ч`;
    return `${m} мин`;
  }

  function formatAccidentPhrase(n) {
    const abs = Math.abs(n);
    const lastTwo = abs % 100;
    const last = abs % 10;
    let word;

    if (lastTwo >= 11 && lastTwo <= 14) {
      word = "аварий";
    } else if (last === 1) {
      word = "авария";
    } else if (last >= 2 && last <= 4) {
      word = "аварии";
    } else {
      word = "аварий";
    }

    return `${n} ${word}`;
  }

  function setLastUpdatedFromHeader(lastModifiedHeader) {
    const el = document.getElementById("last-updated");
    if (!el || !lastModifiedHeader) return;

    const dt = new Date(lastModifiedHeader);
    if (isNaN(dt.getTime())) return;

    el.textContent = formatDateTimeShort(dt);
  }

  function formatDateTimeShort(dt) {
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    const hh = String(dt.getHours()).padStart(2, "0");
    const mn = String(dt.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${mn}`;
  }
})();