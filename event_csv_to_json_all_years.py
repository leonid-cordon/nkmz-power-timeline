import csv
import json
from datetime import datetime
from pathlib import Path

# --- НАСТРОЙКИ ПУТЕЙ ---------------------------------------------

# Путь к CSV, который вы СКОПИРУЕТЕ с SRV3 на свой ПК
INPUT_CSV = r"D:\update_power_stats\srv3_events_6005_6008_2022plus.csv"

# Куда писать JSON для build_outages_all_years.py
OUTPUT_JSON = r"D:\update_power_stats\srv3_events_6005_6008_all.json"

# --- ФОРМАТЫ ДАТЫ+ВРЕМЕНИ ----------------------------------------

DATETIME_FORMATS = [
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%d.%m.%y %H:%M:%S",
    "%d.%m.%y %H:%M",
]


def parse_datetime(dt_str: str) -> datetime:
    dt_str = dt_str.strip().strip('"')
    for fmt in DATETIME_FORMATS:
        try:
            return datetime.strptime(dt_str, fmt)
        except ValueError:
            continue
    raise ValueError(f"Не удалось разобрать дату/время: {dt_str!r}")


def find_column_index(header, *candidates):
    """
    Ищем индекс колонки по нескольким вариантам имени.
    Сравниваем по началу строки в нижнем регистре.
    """
    lower_map = {h.strip().lower(): i for i, h in enumerate(header)}
    for cand in candidates:
        cand_lower = cand.lower()
        for name, idx in lower_map.items():
            if name.startswith(cand_lower):
                return idx
    raise RuntimeError(f"Не нашли колонку ни по одному имени: {candidates!r}")


def main():
    input_path = Path(INPUT_CSV)
    if not input_path.exists():
        print(f"Файл CSV не найден: {input_path}")
        return

    events = []

    # eventquery.vbs пишет CSV в OEM-кодировке (cp866) — так безопаснее
    with input_path.open("r", encoding="cp866", errors="replace", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            print("Пустой CSV-файл, нет заголовка.")
            return

        # Ваши реальные заголовки:
        # "Type","Event","Date Time","Source","ComputerName","Category","User","Description"
        idx_event = find_column_index(header, "event")
        idx_dt = find_column_index(header, "date time", "datetime")
        idx_source = find_column_index(header, "source")
        idx_computer = find_column_index(header, "computername", "computer")
        idx_desc = find_column_index(header, "description", "описание")

        for row in reader:
            if not row or len(row) <= idx_desc:
                continue

            raw_event_id = row[idx_event].strip().strip('"')
            try:
                event_id = int(raw_event_id)
            except ValueError:
                continue

            # интересуют только 6005 и 6008
            if event_id not in (6005, 6008):
                continue

            dt_str = row[idx_dt]
            try:
                dt = parse_datetime(dt_str)
            except ValueError:
                continue

            source = row[idx_source].strip()
            computer = row[idx_computer].strip()
            description = row[idx_desc].strip()

            events.append(
                {
                    "datetime": dt.isoformat(timespec="seconds"),
                    "event_id": event_id,
                    "source": source,
                    "computer": computer,
                    "description": description,
                }
            )

    # сортировка по времени
    events.sort(key=lambda e: e["datetime"])

    out_path = Path(OUTPUT_JSON)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)

    print(f"Готово. Найдено событий 6005/6008: {len(events)}")
    print(f"JSON записан в: {out_path.resolve()}")


if __name__ == "__main__":
    main()
