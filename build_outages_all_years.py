import json
import re
from datetime import datetime, timedelta
from collections import defaultdict

# === НАСТРОЙКИ ===
INPUT_FILE = "srv3_events_6005_6008_all.json"
OUTPUT_FILE = "power_stats_all_years.json"

# сколько минут "допускать" между концом одной аварии и началом следующей,
# чтобы считать их ОДНОЙ длинной аварией.
# Пока ставлю 0: мержим только пересекающиеся/накладывающиеся интервалы.
MERGE_GAP_MINUTES = 0


def load_events(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # ожидаем список событий
    if not isinstance(data, list):
        raise ValueError("Ожидается JSON-список событий")
    return data


def parse_shutdown_time_from_description(desc: str):
    """
    Ищем в описании строку вида:
    '...в 10:15:43 на 02.11.2025 было неожиданным.'
    Возвращаем datetime выключения (shutdown).
    """
    if not desc:
        return None
    pattern = re.compile(
        r"в\s+(\d{1,2}:\d{2}:\d{2})\s+на\s+(\d{2}\.\d{2}\.\d{4})",
        re.U
    )
    m = pattern.search(desc)
    if not m:
        return None
    time_str, date_str = m.group(1), m.group(2)
    # пример: "10:15:43 02.11.2025"
    return datetime.strptime(f"{date_str} {time_str}", "%d.%m.%Y %H:%M:%S")


def extract_intervals_from_events(events):
    """
    Берём только события 6008.
    Для каждого:
      - datetime события = момент включения (boot_dt)
      - из description вытаскиваем предыдущий shutdown_dt
    Возвращаем список сырьевых интервалов {start, end}.
    """
    intervals = []
    skipped_no_desc = 0
    skipped_bad_order = 0

    for ev in events:
        if ev.get("event_id") != 6008:
            continue

        dt_str = ev.get("datetime")
        if not dt_str:
            continue

        try:
            boot_dt = datetime.fromisoformat(dt_str)
        except ValueError:
            # на всякий случай, если формат чуть другой
            try:
                boot_dt = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                continue

        shutdown_dt = parse_shutdown_time_from_description(ev.get("description", ""))
        if not shutdown_dt:
            skipped_no_desc += 1
            continue

        if shutdown_dt >= boot_dt:
            # странная ситуация: время "предыдущего выключения" позже/равно включению
            skipped_bad_order += 1
            continue

        intervals.append({"start": shutdown_dt, "end": boot_dt})

    intervals.sort(key=lambda x: x["start"])

    print(f"Всего событий 6008: {len([e for e in events if e.get('event_id') == 6008])}")
    print(f"Интервалов построено: {len(intervals)}")
    if skipped_no_desc:
        print(f"Пропущено без распознанного описания: {skipped_no_desc}")
    if skipped_bad_order:
        print(f"Пропущено с некорректным порядком времени: {skipped_bad_order}")

    return intervals


def merge_intervals(intervals, gap_minutes=0):
    """
    Склейка интервалов:
    - если текущий.start <= предыдущий.end + gap => считаем одной аварией.
    """
    if not intervals:
        return []

    merged = []
    gap = timedelta(minutes=gap_minutes)

    current = intervals[0].copy()
    for iv in intervals[1:]:
        if iv["start"] <= current["end"] + gap:
            # продолжаем/расширяем текущий интервал
            if iv["end"] > current["end"]:
                current["end"] = iv["end"]
        else:
            # заканчиваем предыдущий и начинаем новый
            merged.append(current)
            current = iv.copy()

    merged.append(current)
    return merged


def build_year_day_structure(intervals):
    """
    Разбиваем интервалы по дням и годам.
    Формат результата:

    {
      2015: {
        "year": 2015,
        "days": {
          "2015-05-01": {
            "outage_count": 1,
            "intervals": [
              {"from": "...", "to": "..."},
              ...
            ]
          },
          ...
        }
      },
      ...
    }
    """
    years = {}

    for iv in intervals:
        start = iv["start"]
        end = iv["end"]
        if end <= start:
            continue

        # для подсчёта "где началась авария"
        start_date = start.date()

        cur = start
        while cur < end:
            day_start = datetime(cur.year, cur.month, cur.day)
            day_end = day_start + timedelta(days=1)

            seg_start = max(cur, day_start)
            seg_end = min(end, day_end)
            if seg_end <= seg_start:
                cur = day_end
                continue

            year = day_start.year
            date_key = day_start.date().isoformat()  # 'YYYY-MM-DD'

            if year not in years:
                years[year] = {"year": year, "days": {}}

            days = years[year]["days"]
            if date_key not in days:
                days[date_key] = {
                    "outage_count": 0,
                    "intervals": []
                }

            day_info = days[date_key]

            # считаем "аварию" только в том дне, где она началась
            if day_start.date() == start_date:
                day_info["outage_count"] += 1

            day_info["intervals"].append({
                "from": seg_start.isoformat(timespec="seconds"),
                "to": seg_end.isoformat(timespec="seconds")
            })

            cur = day_end

    return years


def compute_global_stats(intervals, years_struct):
    total_minutes = 0
    for iv in intervals:
        total_minutes += (iv["end"] - iv["start"]).total_seconds() / 60.0

    days_with_outages = 0
    for year_data in years_struct.values():
        for day_data in year_data["days"].values():
            # если в дне есть хоть один интервал — день с отключением
            if day_data["intervals"]:
                days_with_outages += 1
    return {
        "total_outages": len(intervals),
        "total_minutes": total_minutes,
        "days_with_outages": days_with_outages
    }


def main():
    print(f"Читаю события из {INPUT_FILE} ...")
    events = load_events(INPUT_FILE)

    print("Строю интервалы по 6008 ...")
    raw_intervals = extract_intervals_from_events(events)

    print("Склейка интервалов (мердж дубликатов/пересечений)...")
    merged_intervals = merge_intervals(raw_intervals, gap_minutes=MERGE_GAP_MINUTES)
    print(f"После склейки аварий: {len(merged_intervals)}")

    print("Формирую структуру по годам и дням...")
    years_struct = build_year_day_structure(merged_intervals)

    stats = compute_global_stats(merged_intervals, years_struct)
    print(f"ИТОГО по всем годам:")
    print(f"  Аварий (после склейки): {stats['total_outages']}")
    print(f"  Дней с отключениями:    {stats['days_with_outages']}")
    print(f"  Минут без питания:      {int(stats['total_minutes'])}")

    # готовим итоговый JSON
    result = {
      "years": {
        str(year): years_struct[year]
        for year in sorted(years_struct.keys())
      }
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"JSON записан в: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
