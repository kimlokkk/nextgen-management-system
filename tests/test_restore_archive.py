import pathlib
import subprocess
import sys
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "validate-restore-archive.py"

def run_checker(toc):
    return subprocess.run([sys.executable, str(SCRIPT)], input=toc, text=True, capture_output=True)

class RestorePolicy(unittest.TestCase):
    def test_app_schema(self):
        r=run_checker("1; 2615 2200 SCHEMA - public postgres\n2; 1259 200 TABLE public students postgres\n")
        self.assertEqual(r.returncode,0,r.stderr)
    def test_realtime_function(self):
        r=run_checker("1; 1255 200 FUNCTION realtime list_changes(name, name) postgres\n")
        self.assertEqual(r.returncode,2)
        self.assertIn("realtime",r.stderr)
    def test_auth_storage(self):
        for schema in ("auth","storage","supabase_migrations"):
            with self.subTest(schema=schema):
                self.assertEqual(run_checker(f"1; 1259 10 TABLE {schema} users postgres\n").returncode,2)
    def test_empty_toc_fails(self):
        self.assertNotEqual(run_checker("; list only\n").returncode,0)
