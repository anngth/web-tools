# Web Tools

A collection of client-side web utilities built with React, starting with a TOTP token generator.

## Tools

### TOTP Generator

- RFC 6238 TOTP with HMAC-SHA1
- 6-digit tokens with 30-second refresh interval
- Base32 secrets with spaces and lowercase letters accepted
- Support for `otpauth://` URI scheme (Google Authenticator format)
- Automatic token refresh at the 30-second TOTP boundary
- Visual countdown timer showing time until next refresh
- Copy token by clicking the token or the copy button
- Clipboard fallback for older browsers
- Light mode by default with dark mode toggle
- Responsive sidebar with collapse/expand functionality
- No backend, no API calls, no secret storage

#### URL Parameters

You can pre-fill the secret key using URL parameters:

- `?secret=JBSWY3DPEHPK3PXP`
- `?key=JBSWY3DPEHPK3PXP`
- `?s=JBSWY3DPEHPK3PXP`

Or use the standard `otpauth://` URI format:

- `otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example`

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` directory to any static hosting provider.

## SEO

The project includes:

- ✅ Meta tags (title, description, keywords)
- ✅ Open Graph tags (Facebook, LinkedIn)
- ✅ Twitter Card tags
- ✅ Structured Data (JSON-LD)
- ✅ Sitemap.xml
- ✅ Robots.txt
- ✅ PWA Manifest

## Security

All cryptographic operations are performed client-side using the Web Crypto API. Your secret keys are never transmitted over the network, stored in cookies, or logged anywhere. The application works entirely offline after the initial page load.
