# PDF test material

Routine automated tests generate small original documents using
`src/pdfjs-fixture.ts` and `scripts/create-pdfjs-probe-image.mjs`. The original
text, PDF construction and four-color image are covered by this repository's
MIT license. Long, mixed-size, image-only and bookmark variants are generated
in memory; no third-party document corpus is needed for those tests.

`10.1515_9783111059228.pdf` is a user-supplied diagnostic document for the search
highlight regression. This repository does not establish redistribution rights
to that book. Do not treat its presence or mdview's MIT license as permission
to redistribute it. Review its rights before publishing source archives.
Windows screenshots/reports are diagnostic evidence, not application assets.

The book is used only by the opt-in search-highlighting probe. Normal production
builds exclude all probe pages and PDF fixtures. Run
`node scripts/verify-pdf-release.mjs` after `npm run build` to verify exclusion
and byte-for-byte PDF.js worker/resource/notice delivery. Do not package an
opt-in probe build as a release.
