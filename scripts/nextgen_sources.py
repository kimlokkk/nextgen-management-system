"""Shared parsers for the NextGen source workbooks (Google-Sheet exports). No database access here.

The sheets are hand-formatted: one tab per class slot (e.g. 'SAT 9-10.30AM'), one or more blocks per tab
('SPACE 1', 'NEW CLASS', 'JUNIOR MAKER', 'YOUNG CODER'), student rows below a header row, and a second
facilitator table lower down that repeats the same students and must NOT be read as extra students.
"""
import re

TIME_RE = re.compile(r"(\d{1,2})[.:](\d{2})\s*(AM|PM)\s*-\s*(\d{1,2})[.:](\d{2})\s*(AM|PM)", re.I)
WEEK_RE = re.compile(r"^W\s*(\d)\s*(?:\((\d{1,2})/(\d{1,2})\))?", re.I)

def clean(v): return re.sub(r"\s+", " ", str(v if v is not None else "").strip())
def up(v): return clean(v).upper()
def name_key(s):
    return re.sub(r"\b(BIN|BINTI|BT|BTE|BNT|BNTI|B)\b", "", re.sub(r"[^A-Z0-9 ]", "", up(s))).replace(" ", "")
def phone_key(s):
    d = re.sub(r"\D", "", str(s or ""))
    return d[-9:] if len(d) >= 9 else d
def looks_like_name(v):
    s = clean(v)
    return bool(re.fullmatch(r"[A-Za-z@'.\-/() ]{5,}", s)) and len(s.split()) >= 2
def branch_of(label):
    u = up(label)
    return "MTDC" if "MTDC" in u else "CYBER" if "CYBER" in u else None
def hhmm(h, m, ap):
    h = int(h) % 12 + (12 if ap.upper() == "PM" else 0)
    return f"{h:02d}:{int(m):02d}"

def _is_black(cell):
    f = cell.fill
    return bool(f is not None and f.fill_type is not None and f.fgColor is not None
                and f.fgColor.type == "rgb" and f.fgColor.rgb == "FF000000")

DIRECTORY_HEADERS = {"NAMA PELAJAR", "NAMA STUDENT", "NAMA MURID", "STUDENT NAME"}

def parse_directory(wb):
    """students-parents workbook -> {'MTDC': [row,...], 'CYBER': [...]} (row: name, phone, parent, sheet_row)."""
    out = {}
    for ws in wb.worksheets:
        b = branch_of(ws.title)
        if not b: continue
        out[b] = [dict(name=clean(ws.cell(r, 2).value), phone=clean(ws.cell(r, 3).value), parent=clean(ws.cell(r, 4).value), row=r)
                  for r in range(1, ws.max_row + 1)
                  if looks_like_name(ws.cell(r, 2).value) and up(ws.cell(r, 2).value) not in DIRECTORY_HEADERS]
    return out

def parse_roster(wb, source):
    """Roster workbook -> list of student rows (one per student per block), plus warnings (strings, no PII)."""
    rows, warnings = [], []
    for ws in wb.worksheets:
        title = clean(ws.title)
        if "REPLACEMENT" in up(title): continue
        day = up(title)[:3]
        hr = ci = None
        for r in range(1, 16):
            for c in range(1, 9):
                if up(ws.cell(r, c).value) == "STUDENT NAME": hr, ci = r, c; break
            if hr: break
        if not hr: warnings.append(f"{source}/{title}: no STUDENT NAME header"); continue
        start = end = None
        for r in range(1, hr + 3):
            for c in range(1, 4):
                m = TIME_RE.search(clean(ws.cell(r, c).value))
                if m: start, end = hhmm(*m.group(1, 2, 3)), hhmm(*m.group(4, 5, 6)); break
            if start: break
        if not start: warnings.append(f"{source}/{title}: no time range found")
        cols, rem_cols = {}, []
        for c in range(1, ws.max_column + 1):
            h = up(ws.cell(hr, c).value)
            for want in ("AGE", "CONTACT", "LAPTOP", "COURSE"):
                if h.startswith(want): cols[want] = c
            if h.startswith("REMARK"): rem_cols.append(c)
        weeks = {}
        for c in range(1, ws.max_column + 1):
            t = clean(ws.cell(hr + 1, c).value)
            m = WEEK_RE.match(t)
            if m: weeks[c] = (f"W{m.group(1)}", f"{int(m.group(3)):02d}-{int(m.group(2)):02d}" if m.group(2) else None)
            elif up(t).startswith("PREV"): weeks[c] = ("PREV", None)
        end_row = ws.max_row
        for r in range(hr + 2, ws.max_row + 1):
            if up(ws.cell(r, ci).value) in ("STUDENT NAME",) or "FACI" in up(ws.cell(r, ci + 1).value):
                end_row = r - 1; break
        block = None
        for r in range(hr + 2, end_row + 1):
            for c in range(1, ci - 1):
                t = clean(ws.cell(r, c).value)
                if t and not re.fullmatch(r"\d+(\.0)?", t) and not TIME_RE.search(t): block = up(t)
            nm = ws.cell(r, ci).value
            if not looks_like_name(nm): continue
            seat = ws.cell(r, ci - 1).value
            rows.append(dict(source=source, tab=title, day=day, start=start, end=end, block=block,
                             seat=int(float(seat)) if str(seat or "").replace(".0", "").isdigit() else None,
                             name=clean(nm), age=clean(ws.cell(r, cols["AGE"]).value) if "AGE" in cols else "",
                             contact=clean(ws.cell(r, cols["CONTACT"]).value) if "CONTACT" in cols else "",
                             laptop=up(ws.cell(r, cols["LAPTOP"]).value) if "LAPTOP" in cols else "",
                             course=up(ws.cell(r, cols["COURSE"]).value) if "COURSE" in cols else "",
                             weeks={lab: (up(ws.cell(r, c).value), dt) for c, (lab, dt) in weeks.items() if clean(ws.cell(r, c).value)},
                             # In-memory only, never printed or stored: free-text remarks and which week cells are blacked out.
                             remarks=" ".join(up(ws.cell(r, c).value) for c in rem_cols),
                             black_weeks=[lab for c, (lab, dt) in weeks.items() if lab != "PREV" and _is_black(ws.cell(r, c))],
                             week_labels=[lab for c, (lab, dt) in weeks.items() if lab != "PREV"],
                             row=r))
    return rows, warnings


WEEKHDR_RE = re.compile(r"WEEK\s*(\d)\s*[:\-]\s*(\d{1,2})/(\d{1,2})/(\d{2,4})", re.I)
SLOT_RE = re.compile(r"(MORNING|AFTERNOON|EVENING|NOON)\s*[:\-]\s*(\d{1,2})[.:](\d{2})\s*(AM|PM)\s*-\s*(\d{1,2})[.:](\d{2})\s*(AM|PM)", re.I)
SEAT_RE = re.compile(r"^\d+\.\d+$")

def _parse_orig(v, year=2026):
    import datetime
    if v is None or clean(v) == "": return None, None
    if isinstance(v, datetime.datetime): return v.date(), clean(v.date())
    if isinstance(v, datetime.date): return v, clean(v)
    s = clean(v); m = re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        yy = year if not y else (int(y) + 2000 if len(y) == 2 else int(y))
        try: return datetime.date(yy, mo, d), s
        except ValueError: return None, s
    return None, s

def parse_replacements(wb, source):
    """Replacement tabs -> yellow-seat entries (historical source rows). Also returns warnings (no PII)."""
    import datetime
    out, warnings, norm_warn = [], [], {}
    for ws in wb.worksheets:
        title = clean(ws.title)
        if "REPLACEMENT" not in up(title): continue
        day = up(title)[:3]
        space = 2 if ("SPACE 2" in up(title) or "CLASS REPLACEMENT" in up(title) and "SPACE 1" not in up(title)) else 1
        wk = None; slot = None
        for r in range(1, ws.max_row + 1):
            cells = [clean(ws.cell(r, c).value) for c in range(1, 8)]
            for t in cells:
                m = WEEKHDR_RE.search(t)
                if m:
                    y = int(m.group(4)); y = y + 2000 if y < 100 else y
                    wk = (int(m.group(1)), datetime.date(y, int(m.group(3)), int(m.group(2))))
                m = SLOT_RE.search(t)
                if m:
                    word, h, mi = m.group(1).upper(), int(m.group(2)), int(m.group(3))
                    h24 = (h if h >= 12 else h + 12) if word == "EVENING" else h      # the sheet has "2:00 AM" typos for EVENING
                    st = f"{h24:02d}:{mi:02d}"
                    en = f"{(h24 * 60 + mi + 90) // 60:02d}:{(h24 * 60 + mi + 90) % 60:02d}"   # every class is 90 minutes
                    if hhmm(*m.group(2, 3, 4)) != st or hhmm(*m.group(5, 6, 7)) != en:
                        norm_warn[title] = norm_warn.get(title, 0) + 1
                    slot = (st, en)
            if not SEAT_RE.match(cells[0]) or not looks_like_name(ws.cell(r, 2).value): continue
            if not wk or not slot: warnings.append(f"{source}/{title} r{r}: entry before week/slot header"); continue
            od, oraw = _parse_orig(ws.cell(r, 4).value, wk[1].year)
            out.append(dict(source=source, tab=title, row=r, day=day, space=space, week_no=wk[0], replacement_date=wk[1],
                            start=slot[0], end=slot[1], seat=cells[0], name=clean(ws.cell(r, 2).value), course=up(ws.cell(r, 3).value),
                            original_date=od, original_raw=oraw, tick=clean(ws.cell(r, 5).value), module=up(ws.cell(r, 6).value)))
    for t, n in norm_warn.items(): warnings.append(f"{source}/{t}: {n} slot header(s) had inconsistent AM/PM or length and were normalised")
    return out, warnings


# ----------------------------------------------------------------------------- attendance colour marks
RED_RGB, BLACK_RGB = "FFFF0000", "FF000000"

def _fill_rgb(cell):
    f = cell.fill
    if f is None or f.fill_type is None or f.fgColor is None or f.fgColor.type != "rgb": return None
    return f.fgColor.rgb

def parse_marks(wb, source):
    """Per student per class date: colour of the weekly attendance cell.
    red = absent, black = NextGen closed (client-confirmed meaning), white = anything else.
    Returns list of dict(key, tab, day, date, col, has_text, row). No free text is kept."""
    import datetime
    out = []
    wd = {"SAT": 5, "SUN": 6}
    for ws in wb.worksheets:
        title = clean(ws.title)
        if "REPLACEMENT" in up(title): continue
        day = up(title)[:3]
        hr = ci = None
        for r in range(1, 16):
            for c in range(1, 9):
                if up(ws.cell(r, c).value) == "STUDENT NAME": hr, ci = r, c; break
            if hr: break
        if not hr: continue
        weeks = {}
        for c in range(1, ws.max_column + 1):
            m = WEEK_RE.match(clean(ws.cell(hr + 1, c).value))
            if m:
                d = datetime.date(2026, int(m.group(3)), int(m.group(2)))
                if day in wd:   # a sheet header can carry the wrong weekday (e.g. Sunday column dated on the Saturday): move to that weekday
                    d += datetime.timedelta(days=(wd[day] - d.weekday()) % 7)
                weeks[c] = d
        end_row = ws.max_row
        for r in range(hr + 2, ws.max_row + 1):
            if up(ws.cell(r, ci).value) == "STUDENT NAME" or "FACI" in up(ws.cell(r, ci + 1).value): end_row = r - 1; break
        for r in range(hr + 2, end_row + 1):
            if not looks_like_name(ws.cell(r, ci).value): continue
            for c, d in weeks.items():
                cell = ws.cell(r, c); rgb = _fill_rgb(cell)
                out.append(dict(key=name_key(ws.cell(r, ci).value), tab=title, day=day, date=d, source=source, row=r,
                                col="red" if rgb == RED_RGB else "black" if rgb == BLACK_RGB else "white", has_text=bool(clean(cell.value))))
    return out
