/**
 * NDJSON 编码器。见 02 文档第四节:
 * "事件 schema 和帧格式分开。以后换协议只换编码器。"
 */

import type { StreamEvent } from '../types.js';

export function encodeEvent(event: StreamEvent): string {
  return JSON.stringify(event) + '\n';
}

/**
 * 简单的写入封装,给 Express Response 用。调用方负责设置响应头
 * (X-Accel-Buffering: no 等,见 02 文档第十三节),这里只管编码 + write。
 */
export interface NdjsonWriter {
  write(event: StreamEvent): void;
  end(): void;
}

export function createNdjsonWriter(res: { write: (chunk: string) => void; end: () => void }): NdjsonWriter {
  return {
    write(event: StreamEvent) {
      res.write(encodeEvent(event));
    },
    end() {
      res.end();
    },
  };
}
