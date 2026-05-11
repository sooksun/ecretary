import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

/**
 * Minimal S3 read client for the worker. Mirrors the API's StorageService
 * but only the download path — worker never writes to S3 in M3.
 */
export class WorkerStorage {
  private readonly s3: S3Client;
  readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'msecretary';

    const accessKeyId = process.env.S3_ACCESS_KEY ?? 'minioadmin';
    const secretAccessKey = process.env.S3_SECRET_KEY ?? 'minioadmin';
    const isProd = process.env.NODE_ENV === 'production';
    const usingDefaults = accessKeyId === 'minioadmin' || secretAccessKey === 'minioadmin';

    if (usingDefaults) {
      if (isProd) {
        throw new Error(
          'S3_ACCESS_KEY and S3_SECRET_KEY must be explicitly set in production. ' +
            'The default "minioadmin" credentials must not be used outside of local development.',
        );
      }
      // eslint-disable-next-line no-console
      console.warn(
        '[WorkerStorage] S3_ACCESS_KEY / S3_SECRET_KEY are using insecure MinIO defaults. ' +
          'Set them before going to production.',
      );
    }

    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return this.streamToBuffer(res.Body as Readable);
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of stream) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    return Buffer.concat(chunks);
  }
}

export const storage = new WorkerStorage();
