"""
Check that the new migrations apply cleanly to a database shaped like
production, and can be rolled back and re-applied.

Production was created with Base.metadata.create_all() and then migrated, and
is currently at revision 006. This script rebuilds that state on an EMPTY
Postgres database (DATABASE_URL), then runs:

    stamp 006 -> upgrade head -> downgrade 006 -> upgrade head

Run in CI before any deploy. Never point it at a real database: it drops
everything first.
"""

import os
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BASELINE = "006"
# Tables and columns added after the baseline revision.
NEW_TABLES = {"demo_rooms", "collab_documents", "lessons", "homework_submissions"}
NEW_COLUMNS = {("groups", "schedule")}


def main() -> int:
    url = os.environ["DATABASE_URL"]
    if not any(host in url for host in ("localhost", "127.0.0.1")):
        print("Refusing to run against a non-local database.", file=sys.stderr)
        return 2

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.db.session import Base
    import app.models  # noqa: F401  (register every table)

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    baseline_tables = [t for name, t in Base.metadata.tables.items() if name not in NEW_TABLES]
    Base.metadata.create_all(engine, tables=baseline_tables)
    with engine.begin() as conn:
        for table, column in NEW_COLUMNS:
            conn.execute(text(f'ALTER TABLE "{table}" DROP COLUMN "{column}"'))

    cfg = Config(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini"))
    command.stamp(cfg, BASELINE)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, BASELINE)
    command.upgrade(cfg, "head")

    names = set(inspect(engine).get_table_names())
    missing = NEW_TABLES - names
    if missing:
        print(f"Missing tables after upgrade: {sorted(missing)}", file=sys.stderr)
        return 1
    cols = {c["name"] for c in inspect(engine).get_columns("groups")}
    if "schedule" not in cols:
        print("groups.schedule missing after upgrade", file=sys.stderr)
        return 1
    print("Migrations OK: 006 -> head -> 006 -> head on Postgres.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
