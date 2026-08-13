"""The pieces `sqlite_backend.SqliteCase` is built out of.

`sqlite_backend` owns the store: the schema, the connection, and the one class
that implements `repository.CaseRepository`. Everything here is what that class
reaches for and nothing more — statement shaping (`sql`), the predicates a case
is narrowed by (`filters`), keyset cursors (`cursors`), the denormalised columns
a record is indexed on (`rows`), the derived temporal projection (`temporal`),
and the versioned schema upgrades (`migrations`).

Split out because they were read far more often than the queries around them: a
LIKE escape, a cursor spelling and a migration step are each answerable on their
own, and none of them needs the class to be understood. Import from the module
that owns a name rather than from here — this package deliberately re-exports
nothing, so there is one place each helper lives.
"""
