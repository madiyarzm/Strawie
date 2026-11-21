"""
Seed content for a fresh demo room.

The demo is a small lesson in the real notebook format (text blocks + Python
blocks, see app/core/lesson_rooms.py), so a visitor sees the product
teachers actually use:

  demo:<uuid>:page-<lang>   the class page: explanations and runnable code
  demo:<uuid>:hw-<lang>     the homework as the teacher writes it: a problem,
                            the teacher's solution, starter code and tests
  demo:<uuid>:draw          the whiteboard (starts empty)

<lang> is the visitor's interface language, so a Russian or Kazakh visitor
gets the lesson in their language. Switching language opens a fresh copy.

All code uses only builtins and input(): it runs under Pyodide in the
visitor's browser. The server never executes it.
"""

from __future__ import annotations

import secrets
from typing import Callable, Optional

from pycrdt import Array, Doc, Map, Text

LANGS = ("en", "ru", "kk")

# (kind, text) for the class page. Code is the same in every language except
# for strings and comments the visitor reads.
_PAGE: dict[str, list[tuple[str, str]]] = {
    "en": [
        ("text", "# Lists in Python\nA **list** keeps several values in order. Press ▶ on the code below: it runs right here in your browser."),
        ("code", 'fruits = ["apple", "banana", "cherry"]\nprint(fruits[0])\nprint(len(fruits), "fruits")'),
        ("text", "Variables carry down the page: this block uses `fruits` from the block above. Try adding your own fruit with `append`."),
        ("code", 'fruits.append("mango")\nfor fruit in fruits:\n    print("-", fruit)'),
        ("text", "**Your turn:** run this one and type your name in the box under the code."),
        ("code", 'print("What is your name?")\nname = input()\nprint("Hi, " + name + "!")'),
    ],
    "ru": [
        ("text", "# Списки в Python\n**Список** хранит несколько значений по порядку. Нажмите ▶ у кода ниже: он запускается прямо в вашем браузере."),
        ("code", 'fruits = ["яблоко", "банан", "вишня"]\nprint(fruits[0])\nprint(len(fruits), "фрукта")'),
        ("text", "Переменные доступны ниже по странице: этот блок использует `fruits` из блока выше. Добавьте свой фрукт через `append`."),
        ("code", 'fruits.append("манго")\nfor fruit in fruits:\n    print("-", fruit)'),
        ("text", "**Ваша очередь:** запустите этот блок и введите своё имя в поле под кодом."),
        ("code", 'print("Как тебя зовут?")\nname = input()\nprint("Привет, " + name + "!")'),
    ],
    "kk": [
        ("text", "# Python-дағы тізімдер\n**Тізім** бірнеше мәнді ретімен сақтайды. Төмендегі кодтың ▶ батырмасын басыңыз: ол тікелей браузеріңізде іске қосылады."),
        ("code", 'fruits = ["алма", "банан", "шие"]\nprint(fruits[0])\nprint(len(fruits), "жеміс")'),
        ("text", "Айнымалылар бет бойымен төмен қарай жалғасады: бұл блок жоғарыдағы блоктағы `fruits` тізімін қолданады. `append` арқылы өз жемісіңізді қосып көріңіз."),
        ("code", 'fruits.append("манго")\nfor fruit in fruits:\n    print("-", fruit)'),
        ("text", "**Сіздің кезегіңіз:** осы блокты іске қосып, кодтың астындағы өріске атыңызды жазыңыз."),
        ("code", 'print("Атың кім?")\nname = input()\nprint("Сәлем, " + name + "!")'),
    ],
}

_HW_TEXT = {
    "en": "# Homework: the biggest number\nWrite `biggest(numbers)` that returns the largest number in a list, *without* using `max()`.\n\nThis is the teacher's view: students get the starter code, never your solution, and the tests check their answer in their browser.",
    "ru": "# Домашнее задание: самое большое число\nНапишите `biggest(numbers)`, которая возвращает самое большое число в списке, *не используя* `max()`.\n\nТак домашнее задание видит учитель: ученики получают заготовку, но не ваше решение, а тесты проверяют ответ в их браузере.",
    "kk": "# Үй тапсырмасы: ең үлкен сан\nТізімдегі ең үлкен санды қайтаратын `biggest(numbers)` функциясын `max()` *қолданбай* жазыңыз.\n\nМұғалім үй тапсырмасын осылай көреді: оқушылар сіздің шешіміңізді емес, дайындаманы алады, ал тесттер жауапты олардың браузерінде тексереді.",
}

_HW_FOLLOWUP = {
    "en": "Press **Check with my solution** to run the tests against the solution above. Break the solution on purpose and check again.",
    "ru": "Нажмите **Проверить моим решением**, чтобы прогнать тесты на решении выше. Сломайте решение специально и проверьте снова.",
    "kk": "Тесттерді жоғарыдағы шешімде іске қосу үшін **Менің шешіміммен тексеру** батырмасын басыңыз. Шешімді әдейі бұзып, қайта тексеріп көріңіз.",
}

_SOLUTION = """def biggest(numbers):
    best = numbers[0]
    for n in numbers:
        if n > best:
            best = n
    return best
"""

_STARTER = """def biggest(numbers):
    # your code here
    pass
"""

# (call, expected, hidden)
_TESTS = [
    ("biggest([3, 9, 2])", "9", False),
    ("biggest([-5, -1, -7])", "-1", False),
    ("biggest([42])", "42", True),
]


def _id() -> str:
    return secrets.token_hex(6)


def _block(kind: str, text: str, **extra) -> Map:
    data = {"id": _id(), "type": kind, "text": Text(text)}
    data.update(extra)
    return Map(data)


def _seed_page(lang: str) -> Callable[[Doc], None]:
    def seed(doc: Doc) -> None:
        blocks = doc.get("blocks", type=Array)
        for kind, text in _PAGE[lang]:
            blocks.append(_block(kind, text))

    return seed


def _seed_homework(lang: str) -> Callable[[Doc], None]:
    def seed(doc: Doc) -> None:
        blocks = doc.get("blocks", type=Array)
        blocks.append(_block("text", _HW_TEXT[lang]))
        tests = Array(
            [
                Map({"id": _id(), "kind": "call", "call": call, "expected": expected, "stdin": "", "hidden": hidden})
                for call, expected, hidden in _TESTS
            ]
        )
        blocks.append(_block("code", _SOLUTION, starter=Text(_STARTER), tests=tests))
        blocks.append(_block("text", _HW_FOLLOWUP[lang]))

    return seed


def seed_for(segment: str) -> Optional[Callable[[Doc], None]]:
    """Seed for a demo room segment, a no-op for the whiteboard, or None if
    the segment isn't one of the demo's rooms."""
    if segment == "draw":
        return lambda doc: None
    page, _, lang = segment.partition("-")
    if lang not in LANGS:
        return None
    if page == "page":
        return _seed_page(lang)
    if page == "hw":
        return _seed_homework(lang)
    return None
