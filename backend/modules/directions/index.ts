/**
 * 方向注册表。把四个方向组装成 Direction[](D6 才接进 dispatcher,D4 只建好不接线)。
 * 方向可插拔:增减方向 = 增删这里的装配 + config.directions 一行(见 10 文档第六节)。
 */

import type { Direction } from '../../types.js';
import { createTermDirection } from './term.js';
import { createHotspotDirection } from './hotspot.js';
import { createSubtextDirection } from './subtext.js';
import { createCommunityDirection } from './community.js';

export function createDirections(): Direction[] {
  return [
    createTermDirection(),
    createHotspotDirection(),
    createSubtextDirection(),
    createCommunityDirection(),
  ];
}
