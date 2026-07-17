# Security Policy

## Secrets

- Never commit `.env.local`, API keys, access tokens, or exported user configuration.
- Use `apps/desktop-full/.env.example` for documentation only.
- Keys saved from the application settings are encrypted with Electron `safeStorage`.
- Extension authors must not place real keys in Skill or Tool example files committed to Git.

## Local permissions

The renderer uses a restricted preload API. File access and external HTTP Tool calls should remain behind explicit user confirmation. New tools must declare their risk level and input schema before being added to the Agent registry.

## Reporting

Do not open a public issue containing credentials or personal files. Revoke any exposed key before sharing diagnostic information.

