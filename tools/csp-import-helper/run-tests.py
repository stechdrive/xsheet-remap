"""Standard-library test runner with per-case evidence; CSP/GUI calls remain mocked."""
import json
from pathlib import Path
import platform
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
records = []


class Result(unittest.TextTestResult):
    def startTest(self, test):
        super().startTest(test)
        self.started = time.perf_counter()

    def stopTest(self, test):
        unsuccessful = {case.id() for case, _ in self.failures + self.errors}
        skipped = {case.id() for case, _ in self.skipped}
        records.append({"id": test.id(), "durationMs": round((time.perf_counter() - self.started) * 1000, 2),
                        "status": "failed" if test.id() in unsuccessful else "skipped" if test.id() in skipped else "passed"})
        super().stopTest(test)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover(str(ROOT / "apps/csp-import-helper/tests"), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2, resultclass=Result).run(suite)
    report = ROOT / "reference-local/verification/importer-results.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"python": platform.python_version(), "platform": platform.platform(),
                                 "cases": records, "passed": result.wasSuccessful()}, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() and result.testsRun > 0 else 1)
