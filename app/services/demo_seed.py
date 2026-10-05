"""
Seed content for a fresh demo room.

Kept server-side so the room contents are one authoritative definition
shared by the API, the tests, and (via the API response) the frontend.

Both files are written to run under Pyodide in the visitor's browser: they
use only builtins and `input()`, no imports, no filesystem, no network.
That is what lets the demo run entirely client-side with no server-side
code execution for guests.
"""

from typing import List, TypedDict


class DemoFile(TypedDict):
    """One pre-seeded editor tab."""

    id: str
    name: str
    content: str


# Prints an ASCII diamond. Chosen over a plain "Hello" because a reviewer
# skimming for 60 seconds should see something unmistakably *executed*.
_HELLO_PY = '''# Press Run. This prints an ASCII diamond.

def build_diamond(height):
    """Return the diamond as a list of lines, widest row in the middle."""
    lines = []

    # Top half, including the widest row.
    for row in range(height):
        leading_spaces = " " * (height - row - 1)
        stars = "*" * (2 * row + 1)
        lines.append(leading_spaces + stars)

    # Bottom half mirrors the top, skipping the widest row so it is not
    # printed twice.
    for row in range(height - 2, -1, -1):
        leading_spaces = " " * (height - row - 1)
        stars = "*" * (2 * row + 1)
        lines.append(leading_spaces + stars)

    return lines


for line in build_diamond(6):
    print(line)

print()
print("Strawie is running Python in your browser. No install, no signup.")
'''


# Demonstrates blocking stdin. The reviewer types a name and sees it used.
_INTERACTIVE_PY = '''# Press Run, then type a name when the prompt appears.

# The question is printed on its own line rather than passed to input().
# Browser stdout is flushed per line, so a prompt with no trailing newline
# would not appear before input() blocks -- the reviewer would be asked for
# input without seeing the question. Printing it also keeps the transcript
# in order: question, then the answer they typed.
print("What is your name?")
name = input()

# Guard the empty case so the demo never prints "Hello, !".
if not name.strip():
    name = "stranger"

print()
print("Hello, " + name + "!")
print("-" * (len(name) + 8))

# Show a tiny loop so there is visible output beyond the greeting.
for position, letter in enumerate(name.strip(), start=1):
    print(str(position) + ": " + letter)
'''


# Three lines, as specified. Rendered as a pinned banner, not a file.
BANNER_LINES: List[str] = [
    "Run hello.py - Python executes in your browser via WebAssembly.",
    "Run interactive.py and type a name - that is live stdin.",
    "Click 'Open in second tab' and type - that is real-time CRDT collaboration.",
]


def seed_files() -> List[DemoFile]:
    """Return a fresh copy of the seeded files for a new demo room.

    Returns new dicts each call so a caller mutating the result cannot
    corrupt the seed for the next visitor.
    """
    return [
        {"id": "hello", "name": "hello.py", "content": _HELLO_PY},
        {"id": "interactive", "name": "interactive.py", "content": _INTERACTIVE_PY},
    ]
