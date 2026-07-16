# Third-party notices

The session extraction routine in `session-transfer.js` is derived from:

- WhatsApp Session Extractor
- Copyright (c) Marcos Carraro and contributors
- Source: https://github.com/marcoscarraro/whatsapp-session-extractor
- License: MIT

The derived routine was changed to require explicit consent, avoid downloads and clipboard copies, validate the Noise key locally, and send only to the fixed WappTrack backend origin.
