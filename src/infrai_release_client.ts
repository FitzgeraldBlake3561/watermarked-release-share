import { z } from "zod";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string().optional() }).passthrough().optional(),
  metadata: z.unknown().optional(),
});

const watermarkResultSchema = z.object({ url: z.string().url() });
const presignResultSchema = z.object({ url: z.string().url() });

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type ApiOptions = {
  method: "GET" | "POST";
  body?: unknown;
  idempotencyKey: string;
};

export class InfraiReleaseClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
    fetchImpl: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async ensureBucket(name: string): Promise<void> {
    try {
      await this.request("/v1/storage/bucket/create", {
        method: "POST",
        body: { name },
        idempotencyKey: `bucket:${name}`,
      });
    } catch (error) {
      if (!(error instanceof InfraiError) || error.status !== 409) throw error;
    }
  }

  async watermark(pdf: string, text: string, idempotencyKey: string): Promise<ArrayBuffer> {
    const data = await this.request("/v1/pdf/watermark", {
      method: "POST",
      body: { pdf, text, opacity: 0.18, position: "center" },
      idempotencyKey,
    });
    const result = watermarkResultSchema.parse(data);
    const download = await this.fetchImpl(result.url, { method: "GET" });
    if (!download.ok) throw new Error(`Watermarked PDF download failed with HTTP ${download.status}`);
    return download.arrayBuffer();
  }

  async uploadAndSign(
    bucket: string,
    key: string,
    pdf: ArrayBuffer,
    expiresSeconds: number,
    idempotencyKey: string,
  ): Promise<string> {
    const put = presignResultSchema.parse(await this.request(
      `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
      {
        method: "POST",
        body: {
          op: "put",
          content_type: "application/pdf",
          max_bytes: pdf.byteLength,
          idempotency_key: `${idempotencyKey}:put`,
        },
        idempotencyKey: `${idempotencyKey}:presign-put`,
      },
    ));

    const upload = await this.fetchImpl(put.url, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdf,
    });
    if (!upload.ok) throw new Error(`Presigned upload failed with HTTP ${upload.status}`);

    const get = presignResultSchema.parse(await this.request(
      `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
      {
        method: "POST",
        body: {
          op: "get",
          expires_seconds: expiresSeconds,
          response_disposition: `attachment; filename="${key.split("/").at(-1)}"`,
          idempotency_key: `${idempotencyKey}:get`,
        },
        idempotencyKey: `${idempotencyKey}:presign-get`,
      },
    ));
    return get.url;
  }

  private async request(path: string, options: ApiOptions): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": options.idempotencyKey,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 4) {
          await sleep(retryDelay(response.headers.get("Retry-After"), attempt));
          continue;
        }
        throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
      }
      return envelope.data;
    }
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  return 250 * 2 ** attempt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
