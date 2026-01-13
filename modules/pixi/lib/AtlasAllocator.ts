import * as PIXI from 'pixi.js';
import { numClamp } from '@rapid-sdk/math';

import type { AllocatedRect } from './GuilloteneAllocator.ts';
import { GuilloteneAllocator } from './GuilloteneAllocator.ts';


/** Extended PIXI.Texture with bin allocation info */
interface AtlasTexture extends PIXI.Texture {
  __bin?: AllocatedRect;
}

/** Item stored in the atlas slab */
interface AtlasItem {
  uid: number;
  texture: AtlasTexture | null;
  imageData: ImageData | null;
  uploaded: boolean;
}


/**
 * This texture allocator auto-manages the base-texture with an {@link AtlasSource}. You can also
 * pass a texture source to `allocate`, mimicing {@link Texture.from} functionality.
 *
 * @public
 */
export class AtlasAllocator {
  /** Optional label for debugging */
  label: string;
  /** Size of textures to create */
  size: number;
  /** Array of texture slabs managed by this allocator */
  slabs: AtlasSource[];

  /**
   * Creates an atlas allocator.
   * @constructor
   * @param label - optional label, can be used for debugging
   * @param size - the size of the textures to create
   */
  constructor(label: string = '', size: number = 2048) {
    this.label = label;
    this.size = size;
    this.slabs = [];
  }


  /**
   * allocate
   * Allocates the given asset, returning a `PIXI.Texture`, or throwing if it could not be done.
   * @param imageData - The asset to pack in the atlas, must be of type ImageData
   * @return The issued texture
   * @throws If asset type is unrecognized, or dimensions will not fit on a slab
   */
  allocate(imageData: ImageData): AtlasTexture {
    if (!(imageData instanceof ImageData)) {
      throw new Error('Unsupported asset type - convert it to ImageData first');
    }

    const texture = this._allocateTexture(imageData.width, imageData.height);
    const uid = texture.uid;
    const slab = texture.source as AtlasSource;

    const item: AtlasItem = {
      uid: uid,
      texture: texture,
      imageData: imageData,
      uploaded: false
    };

    slab._items.set(uid, item);
    slab.update();

    return texture;
  }


  /**
   * free
   * Frees the texture and reclaims its space.
   * @param texture - The texture to free
   * @throws If the texture was not found, or some other issue prevents it from freeing.
   */
  free(texture: AtlasTexture): void {
    const slab = this.slabs.find(slab => slab === texture.source) as AtlasSource | undefined;
    const uid = texture.uid;

    if (!slab) {
      throw new Error('Texture is not managed by this AtlasAllocator');
    }

    const bin = texture.__bin;
    if (!bin) {
      throw new Error('Texture bin has been lost.');
    }
    slab._binPacker.free(bin);

    const item = slab._items.get(uid);
    if (!item) {
      throw new Error('Texture not found on slab.');
    }

    item.texture?.destroy(false);
    item.imageData = null;
    item.texture = null;
    slab._items.delete(uid);

//    // no items left, free the slab (unless it's the first slab)
//    if (!slab._items.size && slab !== this.slabs[0]) {
//      slab.destroy();
//      slab._items = null;
//      slab._binPacker = null;
//    }
  }


  /**
   * _allocateTexture
   * Allocates a texture from this allocator.
   * If its existing slab pool has enough space, the texture is issued from one.
   * Otherwise, a new slab is created and the texture is issued from it.
   *
   * @param width - The width of the requested texture.
   * @param height - The height of the requested texture.
   * @return The allocated texture, if successful; otherwise, `null`.
   * @throws When dimensions are too large to fit on a slab
   */
  private _allocateTexture(width: number, height: number): AtlasTexture {
    // We'll always include an extra pixel of padding to avoid color bleeding into neighbor texture.
    const padding = 1;

    // Cannot allocate a texture larger than the slab size.
    if ((width + (2 * padding)) > this.size || (height + (2 * padding)) > this.size) {
      throw new Error(`Texture can not exceed slab size of ${this.size}x${this.size}`);
    }

    // Loop through the slabs and find one with enough space, if any.
    for (const slab of this.slabs) {
      const texture = this._issueTexture(slab, width, height);
      if (texture) return texture;
    }

    // Need another slab.
    const slab = new AtlasSource(this.label, this.size);
    this.slabs.push(slab);

    // Issue the texture from this blank slab.
    return this._issueTexture(slab, width, height)!;
  }


  /**
   * Issues a texture from the given texture slab, if possible.
   *
   * @param slab - The texture slab to allocate frame.
   * @param width - The width of the requested texture.
   * @param height - The height of the requested texture.
   * @return The issued texture, if successful; otherwise, `null`.
   */
  private _issueTexture(slab: AtlasSource, width: number, height: number): AtlasTexture | null {
    // We'll always include an extra pixel of padding to avoid color bleeding into neighbor texture.
    const padding = 1;

    const bin = slab._binPacker.allocate(width + (2 * padding), height + (2 * padding));
    if (!bin) return null;

    const texture: AtlasTexture = new PIXI.Texture({
      source: slab,
      frame: bin.clone().pad(-padding)   // The actual frame shouldn't include the padding
    });

    texture.__bin = bin;   // important to preserve this, it contains `__mem_area`
    return texture;
  }

}



/**
 * AtlasSource
 * An {@code AtlasSource} is used by {@link AtlasAllocator} to manage texture sources.
 * @public
 */
export class AtlasSource extends PIXI.TextureSource<PIXI.BufferSourceOptions> {
  /** Map of texture UID to AtlasItem */
  _items: Map<number, AtlasItem>;
  /** The bin packer for this slab */
  _binPacker: GuilloteneAllocator;

  /**
   * Creates a TextureSource for the textures in the atlas (aka a "slab")
   * @param label - optional label, can be used for debugging
   * @param size - the size of the textures to create
   */
  constructor(label: string, size: number) {
    super({
      antialias: false,
      autoGarbageCollect: false,
      autoGenerateMipmaps: false,
      dimensions: '2d',
      format: 'rgba8unorm',
      height: size,
      label: label,
      resolution: 1,
      width: size
    });
    this.uploadMethodId = 'atlas';

    this._items = new Map();
    this._binPacker = new GuilloteneAllocator(size, size);
  }
}


/** WebGL upload handler interface */
interface GLUploadHandler {
  id: string;
  upload(
    slab: AtlasSource,
    glTexture: PIXI.GlTexture,
    gl: WebGL2RenderingContext,
    webGLVersion: number
  ): void;
}

/** WebGPU upload handler interface */
interface GPUUploadHandler {
  type: string;
  upload(
    slab: AtlasSource,
    gpuTexture: GPUTexture,
    gpu: { device: GPUDevice }  // Pixi internal GPU context with device
  ): void;
}


// WebGL Uploader
const glUploadAtlasResource: GLUploadHandler = {
  id: 'atlas',
  upload(slab: AtlasSource, glTexture: PIXI.GlTexture, gl: WebGL2RenderingContext, webGLVersion: number): void {
    const { width, height } = slab;
    const { target, format, type } = glTexture;
    const premultipliedAlpha = slab.alphaMode === 'premultiply-alpha-on-upload';

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultipliedAlpha);

    // Allocate the texture on the GPU
    if (glTexture.width !== width || glTexture.height !== height) {
      glTexture.width = width;
      glTexture.height = height;

// fill red
//const size = width * height;
//const pixels = new Uint8Array(size * 4);
//for (let i = 0; i < size; i++) {
//  const j = i * 4;
//  pixels[j] = 255;
//  pixels[j+1] = 0;
//  pixels[j+2] = 0;
//  pixels[j+3] = 255;
//}
      gl.texImage2D(target, 0, format, width, height, 0, format, type, null);    // no fill
//      gl.texImage2D(target, 0, format, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);  // fill red
    }

    // Upload all atlas items.
    for (const item of slab._items.values()) {
      if (item.uploaded) continue;

      const bin = item.texture!.__bin!;
      const { x, y, width: w, height: h } = bin;
      const { data: src, width: srcW, height: srcH } = item.imageData!;

      // Copy image data to a new Uint8Array that duplicates the 1px edge
      const pixels = new Uint8Array(w * h * 4);

      for (let dstY = 0; dstY < h; dstY++) {
        const srcY = numClamp(dstY-1, 0, srcH-1);

        for (let dstX = 0; dstX < w; dstX++) {
          const srcX = numClamp(dstX-1, 0, srcW-1);
          const s = ((srcY * srcW) + srcX) * 4;
          const d = ((dstY * w) + dstX) * 4;
          pixels[d] = src[s];
          pixels[d+1] = src[s+1];
          pixels[d+2] = src[s+2];
          pixels[d+3] = src[s+3];
        }
      }

      gl.texSubImage2D(target, 0, x, y, w, h, format, type, pixels);

      item.uploaded = true;
    }
  }
};


// WebGPU Uploader
const gpuUploadAtlasResource: GPUUploadHandler = {
  type: 'atlas',
  upload(slab: AtlasSource, gpuTexture: GPUTexture, gpu: { device: GPUDevice }): void {
    // const premultipliedAlpha = slab.alphaMode === 'premultiply-alpha-on-upload';

    for (const item of slab._items.values()) {
      if (item.uploaded) continue;

      const bin = item.texture!.__bin!;
      const { x, y, width: w, height: h } = bin;
      const { data: src, width: srcW, height: srcH } = item.imageData!;

      // Copy image data to a new Uint8Array that duplicates the 1px edge
      const pixels = new Uint8Array(w * h * 4);

      for (let dstY = 0; dstY < h; dstY++) {
        const srcY = numClamp(dstY-1, 0, srcH-1);

        for (let dstX = 0; dstX < w; dstX++) {
          const srcX = numClamp(dstX-1, 0, srcW-1);
          const s = ((srcY * srcW) + srcX) * 4;
          const d = ((dstY * w) + dstX) * 4;
          pixels[d] = src[s];
          pixels[d+1] = src[s+1];
          pixels[d+2] = src[s+2];
          pixels[d+3] = src[s+3];
        }
      }

      const destination = { origin: { x: x, y: y }, texture: gpuTexture };
      const layout = { bytesPerRow: pixels.byteLength / h };
      const size = { width: w, height: h };

      gpu.device.queue.writeTexture(destination, pixels, layout, size);

      item.uploaded = true;
    }
  }
};



/**
 * Registers the upload handlers with the given Pixi renderer
 * @param renderer - The Pixi renderer to register handlers with
 * @public
 */
export function registerAtlasUploader(renderer: PIXI.Renderer): void {
  const textureSystem = renderer.texture as any;  // Access internal _uploads map
  if (renderer.type === PIXI.RendererType.WEBGL) {
    textureSystem._uploads.atlas = glUploadAtlasResource;
  } else {
    textureSystem._uploads.atlas = gpuUploadAtlasResource;
  }
}
