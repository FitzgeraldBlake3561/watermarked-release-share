import assert from "node:assert/strict";
import test from "node:test";
import { decideExternalShare, type ShareRequest } from "../src/release_policy.js";

const passingRelease: ShareRequest = {
  releaseId: "cli-v2.8.0",
  build: {
    revision: "7cf341af9bce98d2",
    status: "passed",
    finishedAt: "2026-09-12T08:30:00.000Z",
  },
  operation: "external_share",
  diagnostics: [{ severity: "warning", message: "bundle is 3% larger" }],
  pdfBase64: "JVBERi0xLjQK",
  expiresSeconds: 3600,
};

test("approves a passed build and derives an auditable watermark", () => {
  assert.deepEqual(decideExternalShare(passingRelease), {
    state: "approved",
    watermark: "EXTERNAL cli-v2.8.0 7cf341af9bce",
    objectKey: "developer-releases/cli-v2.8.0/7cf341af9bce.pdf",
  });
});

test("blocks external sharing when diagnostics contain an error", () => {
  const result = decideExternalShare({
    ...passingRelease,
    diagnostics: [{ severity: "error", message: "command reference is incomplete" }],
  });
  assert.deepEqual(result, {
    state: "blocked",
    reason: "release diagnostics contain errors",
  });
});
