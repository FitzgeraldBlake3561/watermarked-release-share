import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, InfraiReleaseClient } from "./infrai_release_client.js";
import { decideExternalShare, shareRequestSchema } from "./release_policy.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const bucket = process.env.INFRAI_BUCKET ?? "developer-release-documents";
const port = Number(process.env.PORT ?? 8787);
const client = new InfraiReleaseClient(apiKey);

await client.ensureBucket(bucket);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/release-shares") {
    return json(response, 404, { error: "route not found" });
  }

  try {
    const input = shareRequestSchema.parse(await readJson(request));
    const decision = decideExternalShare(input);
    if (decision.state === "blocked") {
      return json(response, 409, decision);
    }

    const watermarked = await client.watermark(
      input.pdfBase64,
      decision.watermark,
      `${input.releaseId}:watermark`,
    );
    const downloadUrl = await client.uploadAndSign(
      bucket,
      decision.objectKey,
      watermarked,
      input.expiresSeconds,
      input.releaseId,
    );
    return json(response, 201, {
      state: "shared",
      releaseId: input.releaseId,
      objectKey: decision.objectKey,
      downloadUrl,
      expiresSeconds: input.expiresSeconds,
    });
  } catch (error) {
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.code });
    }
    if (error instanceof ZodError) {
      return json(response, 400, { error: "invalid request body" });
    }
    return json(response, 500, { error: "request processing failed" });
  }
}).listen(port, () => {
  console.log(`release share service listening on http://localhost:${port}`);
});

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
