# Contracts

Runtime-validated schemas and inferred TypeScript types shared across apps:
HTTP requests and responses, WebSocket messages, board events, and job payloads.

This package contains no database access or business logic.

The first work unit adds `liveResponseSchema` and `readyResponseSchema`.
`LiveResponse` and `ReadyResponse` are their inferred TypeScript types.
The schemas reject extra fields. The readiness schema also checks that the
overall status agrees with both check results.
