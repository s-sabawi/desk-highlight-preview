# Desk Highlight

Desk Highlight is a browser editor for choosing a page, marking one
passage, and producing a 25-second 3D desk video.

This repository contains the editor interface and a fictional sample.
The render service is **not connected** in this version. The API returns
404, so the editor cannot accept uploads or start a render. No scene,
renderer, credentials, private documents, or rendered videos are included.

## Run the checks

Use Node.js 24:

```sh
npm ci
npm run build
```

The static editor lives in `public/`. A Vercel project can serve it from
the repository root with the Other preset; the included configuration
serves only that folder and defines the disabled same-origin API. The
editor stays unarmed until a compatible authorized backend is configured.
