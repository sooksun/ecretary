import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export interface PutObjectInput {
  key: string;
  body: Buffer | Readable;
  contentType?: string;
  contentLength?: number;
}

/**
 * Storage abstraction. Default impl: S3-compatible (MinIO).
 * Falls back to local-disk under apps/api/uploads when STORAGE_DRIVER=local.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 'local' | 's3';
  private readonly bucket: string;
  private readonly localRoot: string;
  private s3?: S3Client;
  private bucketReady = false;

  constructor(private readonly config: ConfigService) {
    this.driver = (config.get<string>('STORAGE_DRIVER') ?? 's3') as 'local' | 's3';
    this.bucket = config.get<string>('S3_BUCKET') ?? 'msecretary';
    this.localRoot = join(process.cwd(), 'uploads');

    if (this.driver === 's3') {
      const accessKeyId = config.get<string>('S3_ACCESS_KEY') ?? 'minioadmin';
      const secretAccessKey = config.get<string>('S3_SECRET_KEY') ?? 'minioadmin';
      const isProd = config.get<string>('NODE_ENV') === 'production';
      const usingDefaults = accessKeyId === 'minioadmin' || secretAccessKey === 'minioadmin';

      if (usingDefaults) {
        if (isProd) {
          throw new Error(
            'S3_ACCESS_KEY and S3_SECRET_KEY must be explicitly set in production. ' +
              'The default "minioadmin" credentials must not be used outside of local development.',
          );
        }
        this.logger.warn(
          'S3_ACCESS_KEY / S3_SECRET_KEY are using insecure MinIO defaults. Set them before going to production.',
        );
      }

      this.s3 = new S3Client({
        endpoint: config.get<string>('S3_ENDPOINT'),
        region: config.get<string>('S3_REGION') ?? 'us-east-1',
        forcePathStyle: (config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  private async ensureBucket(): Promise<void> {
    if (this.driver !== 's3' || !this.s3 || this.bucketReady) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketReady = true;
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket: ${this.bucket}`);
        this.bucketReady = true;
      } catch (err) {
        throw new Error(
          `Storage bucket "${this.bucket}" is not accessible and could not be created: ${(err as Error).message}`,
        );
      }
    }
  }

  private assertLocalKey(key: string): string {
    const filePath = join(this.localRoot, key);
    const rootResolved = resolve(this.localRoot) + sep;
    if (!resolve(filePath).startsWith(rootResolved)) {
      throw new Error(`Storage key escapes the local root: "${key}"`);
    }
    return filePath;
  }

  async putObject(input: PutObjectInput): Promise<{ key: string; url: string }> {
    if (this.driver === 'local') {
      const filePath = this.assertLocalKey(input.key);
      await fs.mkdir(dirname(filePath), { recursive: true });
      const buf = Buffer.isBuffer(input.body)
        ? input.body
        : await this.streamToBuffer(input.body);
      await fs.writeFile(filePath, buf);
      return { key: input.key, url: `file://${filePath}` };
    }

    await this.ensureBucket();
    if (!this.s3) throw new Error('S3 client not initialized');

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
    );
    return { key: input.key, url: `s3://${this.bucket}/${input.key}` };
  }

  async getSignedDownloadUrl(key: string, expiresInSec = 3600): Promise<string> {
    if (this.driver === 'local') {
      return `file://${this.assertLocalKey(key)}`;
    }
    if (!this.s3) throw new Error('S3 client not initialized');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
  }

  /** Used by worker — download object as a buffer. */
  async getObjectBuffer(key: string): Promise<Buffer> {
    if (this.driver === 'local') {
      return fs.readFile(this.assertLocalKey(key));
    }
    if (!this.s3) throw new Error('S3 client not initialized');
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return this.streamToBuffer(res.Body as Readable);
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.driver === 'local') {
      await Promise.allSettled(
        keys.map(async (key) => {
          // assertLocalKey throws on path-traversal — propagates as a rejection
          // to allSettled so the caller can observe it rather than silently skip.
          const filePath = this.assertLocalKey(key);
          await fs.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') throw err; // only silence "already gone"
          });
        }),
      );
      return;
    }
    if (!this.s3) throw new Error('S3 client not initialized');
    // Delete in parallel; allSettled so one missing object doesn't abort others.
    await Promise.allSettled(
      keys.map((key) =>
        this.s3!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
      ),
    );
  }

  /**
   * `UploadChunkMetaSchema` already restricts clientChunkId to `[A-Za-z0-9_-]`,
   * but this method builds a storage path from caller-supplied strings, so it
   * re-checks rather than trusting every future caller to have validated first.
   * The local-disk backend has its own traversal guard in `putObject`; S3 keys
   * are opaque, which is exactly why a bad segment would go unnoticed there.
   */
  buildChunkKey(meetingId: string, clientChunkId: string, ext: string): string {
    for (const [name, value] of [
      ['meetingId', meetingId],
      ['clientChunkId', clientChunkId],
      ['ext', ext],
    ] as const) {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new BadRequestException(`${name} contains characters not allowed in a storage key`);
      }
    }
    return `meetings/${meetingId}/chunks/${clientChunkId}.${ext}`;
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of stream) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    return Buffer.concat(chunks);
  }
}
