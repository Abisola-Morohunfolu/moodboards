# Board modules

Reserved for the module registry and self-contained module implementations when
Phase 2 introduces the second kit. Phase 1 approvals and budget remain ordinary
application features so this boundary is learned from two real use cases.

Each future module owns its routes, handlers, queries, tables, and fixed UI-slot
components. Modules communicate through board events or declared query APIs,
never by importing another module's tables.
