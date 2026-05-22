"""
Suspicious code pattern detection for student submissions.

Scans Python source code for patterns that indicate sandbox escape attempts,
unauthorized system access, or network activity. Used by the admin panel to
surface submissions that warrant manual review.
"""

import re

_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    ("system_exec", "OS command execution",
     re.compile(r"\bos\s*\.\s*(system|popen|exec[lv]p?e?)\b")),
    ("subprocess", "Subprocess usage",
     re.compile(r"\bsubprocess\b")),
    ("import_os", "Importing os module",
     re.compile(r"(?:__import__|importlib)\s*\(\s*['\"]os['\"]\s*\)")),
    ("import_dangerous", "Importing dangerous module",
     re.compile(r"(?:import|__import__\s*\(\s*['\"])\s*(?:subprocess|shutil|ctypes|signal|multiprocessing)")),
    ("builtins_escape", "Accessing __builtins__ or __subclasses__",
     re.compile(r"__(?:builtins|subclasses|mro|class|globals|import)__")),
    ("eval_exec", "eval/exec/compile calls",
     re.compile(r"\b(?:eval|exec|compile)\s*\(")),
    ("file_access", "Sensitive file access",
     re.compile(r"""(?:open|Path)\s*\(\s*['"]\/(?:etc|proc|sys|dev|tmp|var)""")),
    ("network", "Network/socket usage",
     re.compile(r"\b(?:socket|requests|urllib|http\.client|ftplib|smtplib)\b")),
    ("env_access", "Environment variable access",
     re.compile(r"\bos\s*\.\s*(?:environ|getenv)\b")),
    ("code_object", "Code object manipulation",
     re.compile(r"\b(?:__code__|co_code|f_locals|f_globals|gi_frame)\b")),
    ("pickle", "Pickle deserialization (code execution vector)",
     re.compile(r"\bpickle\s*\.\s*loads?\b")),
]


def scan_code(code: str) -> list[dict]:
    """Return a list of flags found in the given code.

    Each flag is ``{"pattern": str, "label": str, "line": int, "snippet": str}``.
    """
    flags: list[dict] = []
    lines = code.split("\n")
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        for pattern_id, label, regex in _PATTERNS:
            if regex.search(line):
                flags.append({
                    "pattern": pattern_id,
                    "label": label,
                    "line": i,
                    "snippet": line.strip()[:120],
                })
    return flags
