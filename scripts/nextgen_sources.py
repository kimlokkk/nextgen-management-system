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

def parse_directory(wb):
    """students-parents workbook -> {'MTDC': [row,...], 'CYBER': [...]} (row: name, phone, parent, sheet_row)."""
    out = {}
    for ws in wb.worksheets:
        b = branch_of(ws.title)
        if not b: continue
        out[b] = [dict(name=clean(ws.cell(r, 2).value), phone=clean(ws.cell(r, 3).value), parent=clean(ws.cell(r, 4).value), row=r)
                  for r in range(2, ws.max_row + 1) if looks_like_name(ws.cell(r, 2).value)]
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
        cols = {}
        for c in range(1, ws.max_column + 1):
            h = up(ws.cell(hr, c).value)
            for want in ("AGE", "CONTACT", "LAPTOP", "COURSE"):
                if h.startswith(want): cols[want] = c
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
                             row=r))
    return rows, warnings
