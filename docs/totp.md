# TOTP Generator

The TOTP tool runs entirely in the browser. It makes no API calls and does not store the secret.

- RFC 6238 TOTP with HMAC-SHA1
- 6-digit tokens with a 30-second refresh interval
- Base32 secrets with spaces and lowercase letters accepted
- Support for the `otpauth://` URI scheme (Google Authenticator format)
- Automatic token refresh at the 30-second TOTP boundary
- Visual countdown until the next refresh
- Copy the token by clicking the token or the copy button
- Clipboard fallback for older browsers
- Light mode by default, with a dark mode toggle
- Responsive sidebar with collapse and expand

The page is `/totp`.

## URL parameters

Pre-fill the secret with:

- `?secret=JBSWY3DPEHPK3PXP`
- `?key=JBSWY3DPEHPK3PXP`
- `?s=JBSWY3DPEHPK3PXP`

Or use an `otpauth://` URI:

```txt
otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example
```

Secrets are not sent to the URL shortener API, stored in cookies, or written to logs.
