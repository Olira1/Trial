# TODO

## Authentication Security

The current configuration permits access and refresh tokens to remain valid for
up to one year. Complete these items before relying on long-lived sessions in
production:

- [ ] Rotate refresh tokens on every refresh.
- [ ] Detect refresh-token reuse and revoke the entire session.
- [ ] Add per-device session management and remote logout.
- [ ] Revoke all sessions after password reset or account compromise.
- [ ] Configure a separate, shorter admin-session TTL.
- [ ] Require secure client storage; never store refresh tokens in browser
      `localStorage`.
