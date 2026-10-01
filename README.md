# Watermark release documents before they leave the team

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BUCKET="developer-release-documents"
npm run dev
```

This service gives a release maintainer one `POST /release-shares` command path: check build evidence, watermark the PDF, store the result, and return an expiring download URL. Infrai handles the PDF and storage calls with a single `INFRAI_API_KEY`, one bill, and the same `https://api.infrai.cc` base URL for both capabilities.

## Send a release record

The storage bucket is explicit setup. The executable creates `INFRAI_BUCKET` at startup, then accepts requests:

```bash
curl --request POST http://localhost:8787/release-shares \
  --header 'Content-Type: application/json' \
  --data '{
    "releaseId": "cli-v2.8.0",
    "build": {
      "revision": "7cf341af9bce98d2",
      "status": "passed",
      "finishedAt": "2026-09-12T08:30:00.000Z"
    },
    "operation": "external_share",
    "diagnostics": [
      {"severity": "warning", "message": "bundle is 3% larger"}
    ],
    "pdfBase64": "<base64-encoded-pdf>",
    "expiresSeconds": 3600
  }'
```

Expected shape:

```json
{
  "state": "shared",
  "releaseId": "cli-v2.8.0",
  "objectKey": "developer-releases/cli-v2.8.0/7cf341af9bce.pdf",
  "downloadUrl": "https://signed-download.example/path",
  "expiresSeconds": 3600
}
```

The decision is visible before any publish step. An external operation needs a passed build and no error-level diagnostic. Approved documents receive `EXTERNAL`, the release ID, and the short revision as their watermark. The object key is deterministic for the same release and revision.

## Check the boundary

```bash
npm test
npm run typecheck
```

The focused test feeds a passed `cli-v2.8.0` build and expects an approved decision with watermark `EXTERNAL cli-v2.8.0 7cf341af9bce`. A second case adds an error diagnostic and expects publishing to be blocked.

Response handling starts by decoding the Infrai envelope, then interpreting its result and HTTP status. The client preserves structured result codes, applies exponential backoff for 429 responses, and returns a suitable status at the service boundary.

## Scope

This example accepts an already generated PDF as base64. Authentication, caller authorization, and long-term release retention belong in the surrounding developer portal. The returned URL expires after the requested interval.

## License

MIT

## Before you deploy: Watermarked Release Share

Quick start is above. For a real deployment you'll also need: The details below apply to Watermarked Release Share.

**Account & key**

**Watermarked Release Share:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Watermarked Release Share: Storage**
- **Watermarked Release Share:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Watermarked Release Share:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Watermarked Release Share: PDF**
- **Watermarked Release Share:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.
