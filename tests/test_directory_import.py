"""Synthetic tests for the parents/students directory part of the data-refresh importer. No real data, no database."""
import importlib.util, pathlib, sys, unittest

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("refresh", SCRIPTS / "refresh-data-from-sources.py")
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
import nextgen_sources as S

class Cell:
    def __init__(self, v): self.value = v
class Sheet:
    def __init__(self, title, rows): self.title, self.rows = title, rows
    @property
    def max_row(self): return len(self.rows)
    def cell(self, r, c):
        row = self.rows[r - 1] if r - 1 < len(self.rows) else ()
        return Cell(row[c - 1] if c - 1 < len(row) else None)
class Book:
    def __init__(self, *sheets): self.worksheets = list(sheets)

class PhoneNumbers(unittest.TestCase):
    def test_single_number_with_spaces_and_dashes(self):
        self.assertEqual(R.clean_phone("0 14-450 0007"), "0144500007")
    def test_two_numbers_separated_by_slash_keep_the_first(self):
        self.assertEqual(R.phone_numbers("012-3450001/ 0 13-450 0002"), ["0123450001", "0134500002"])
        self.assertEqual(R.clean_phone("012-3450001/ 0 13-450 0002"), "0123450001")
    def test_daftar_label_is_not_part_of_a_number(self):
        self.assertEqual(R.phone_numbers("0 17-450 0003 (DAFTAR WS) / 0194500004"), ["0174500003", "0194500004"])
        self.assertEqual(R.phone_numbers(" 013-4500005 (DAFTAR) / 013-4500006"), ["0134500005", "0134500006"])
    def test_empty_and_short_values_do_not_crash(self):
        self.assertEqual(R.clean_phone(""), ""); self.assertEqual(R.clean_phone(None), "")
        self.assertEqual(R.clean_phone("12345"), "12345")  # kept so the unusual-length notice still fires

class DirectoryParsing(unittest.TestCase):
    def test_header_row_is_never_a_student_and_both_branches_are_read(self):
        wb = Book(
            Sheet("MTDC", [("BIL", "NAMA PELAJAR", "NOMBOR PHONE", "NAMA IBU/AYAH"), (1, "SYNTH ALPHA BIN ONE", "012-1110000", "ONE PARENT")]),
            Sheet("CYBER", [(None, None, None, None), ("BIL", "NAMA PELAJAR", "NOMBOR PHONE", "NAMA IBU/AYAH"), (1, "SYNTH BETA BINTI TWO", "013-2220000", "TWO PARENT")]),
            Sheet("Notes", [(1, "NOT A BRANCH SHEET", "x", "y")]))
        d = S.parse_directory(wb)
        self.assertEqual(sorted(d), ["CYBER", "MTDC"])
        self.assertEqual([r["name"] for r in d["MTDC"]], ["SYNTH ALPHA BIN ONE"])
        self.assertEqual([r["name"] for r in d["CYBER"]], ["SYNTH BETA BINTI TWO"])

class ParentAttachment(unittest.TestCase):
    def attach(self, parents, guardians, student, parent, phone):
        R.attach_parent(parents, guardians, student, dict(parent=parent, phone=phone, name=student["name"]), [], {})
    def student(self, name): return dict(id=name, name=name, notices=[], extra=[])

    def test_siblings_with_the_same_parent_and_phone_share_one_parent(self):
        parents, guardians = {}, []
        a, b = self.student("SYNTH A"), self.student("SYNTH B")
        self.attach(parents, guardians, a, "SHARED PARENT", "0 15-450 0008")
        self.attach(parents, guardians, b, "SHARED PARENT", "015-450 0008")
        self.assertEqual(len(parents), 1); self.assertEqual(len(guardians), 2)
        self.assertEqual({g["parent"]["id"] for g in guardians}, {next(iter(parents.values()))["id"]})

    def test_second_number_is_kept_in_the_parent_note_not_glued_into_the_phone(self):
        parents, guardians = {}, []
        st = self.student("SYNTH C")
        self.attach(parents, guardians, st, "TWO NUMBERS PARENT", "012-3450001/ 0 13-450 0002")
        p = next(iter(parents.values()))
        self.assertEqual(p["phone"], "0123450001")
        self.assertIn("0134500002", p["notes"])
        self.assertEqual([c for c, _ in st["notices"]], [])

    def test_missing_parent_name_creates_no_parent_and_flags_the_student(self):
        parents, guardians = {}, []
        st = self.student("SYNTH D")
        self.attach(parents, guardians, st, "", "012-0000000")
        self.assertEqual(parents, {}); self.assertEqual(guardians, [])
        self.assertEqual([c for c, _ in st["notices"]], ["NO_GUARDIAN"])

if __name__ == "__main__":
    unittest.main()
