# mattgab-voice

## Lead post

`postLeadToDashboard` reads two optional environment variables. Set them on the host. Do not commit values.

- `LEAD_API_URL` — lead endpoint. When unset, the server uses its built-in default.
- `AI_LEAD_KEY` — when set, sent as the `X-API-Key` header. When unset, that header is omitted. The value is never logged.
