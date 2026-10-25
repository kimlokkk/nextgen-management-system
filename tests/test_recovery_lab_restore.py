import importlib.util
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

path=Path(__file__).resolve().parents[1]/"scripts"/"restore-recovery-lab.py"
spec=importlib.util.spec_from_file_location("safe_restore",path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class RestoreSafetyTests(TestCase):
    def test_archive_selection_excludes_managed_functions_sessions(self):
        archive=""";
1; 100 100 FUNCTION realtime list_changes postgres
2; 100 100 TABLE DATA auth users postgres
3; 100 100 TABLE DATA auth identities postgres
4; 100 100 TABLE DATA auth sessions postgres
5; 100 100 TABLE DATA public students postgres
6; 100 100 TABLE DATA public parents postgres
7; 100 100 SEQUENCE SET public audit_id_seq postgres
8; 100 100 TABLE DATA storage objects postgres
"""
        with patch.object(mod,"run",return_value=archive):
            selected=mod.selected_toc(Path("/dev/null"),{"students","parents"})
        text="\n".join(selected)
        self.assertIn("auth users",text)
        self.assertIn("auth identities",text)
        self.assertIn("public students",text)
        self.assertIn("SEQUENCE SET public",text)
        self.assertNotIn("auth sessions",text)
        self.assertNotIn("FUNCTION realtime",text)
        self.assertNotIn("storage objects",text)

    def test_missing_identity_table_stops(self):
        content="1; 100 100 TABLE DATA auth users postgres\n2; 100 100 TABLE DATA public students postgres\n"
        with patch.object(mod,"run",return_value=content):
            with self.assertRaises(SystemExit):
                mod.selected_toc(Path("/dev/null"),{"students"})

    def test_guards_are_transaction_ready_and_fail_closed(self):
        baseline={"students":2,"parents":1,"active_enrollments":1,
        "september_source_rows":1,"october_source_rows":1,
        "november_classes":2,"november_bookings":1}
        pre,verify=mod.build_guard(["branches","students"],baseline)
        self.assertIn("TRUNCATE TABLE public.\"branches\",public.\"students\"",pre)
        self.assertIn("Recovery target not fresh",pre)
        self.assertIn("Foreign key validation failed",verify)
        self.assertIn("Snapshot baseline mismatch: november_bookings",verify)
        self.assertNotIn("DROP TABLE",pre+verify)

    def test_missing_snapshot_baseline_refused(self):
        with self.assertRaises(SystemExit):
            mod.build_guard(["students"],{"students":1})
