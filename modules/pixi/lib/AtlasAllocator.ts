import * as PIXI from 'pixi.js';

import { GuilloteneAllocator, type AllocatedRect } from './GuilloteneAllocator.ts';


/** Extended PIXI.Texture with bin allocation info */
export interface AtlasTexture extends PIXI.Texture {
  __bin?: AllocatedRect;
}

/** Atlas constructor options */
export interface AtlasOptions {
  /** The size of the atlas slab textures to create (default 2048) */
  size: number;
  /** Optional label used to identify the AtlasAllocator, useful for debugging */
  label?: string;
  /** If true, atlas sources will be backed by a canvas element (default false) */
  useCanvas?: boolean;
}

/** A pixel source the atlas knows how to upload directly to the GPU. */
export type AtlasItemSource = ImageData | HTMLCanvasElement | ImageBitmap | HTMLImageElement;

/** Item stored in the atlas slab */
export interface AtlasItem {
  /** The texture unique id (comes from Pixi) */
  uid: number;
  /** A Pixi.Texture allocated from the atlas source */
  texture: AtlasTexture | null;
  /**
   * The pixel source for this item.  Uploaded directly to the GPU via
   * `texSubImage2D` (WebGL) or `copyExternalImageToTexture` (WebGPU).
   */
  source: AtlasItemSource | null;
  /**
   * True if `source` already includes a 1px edge-replicated padding ring
   * (i.e. source dimensions are `bin.width` x `bin.height`, not the frame size).
   * Tile imagery sets this so neighbor textures don't bleed across rect boundaries
   * under bilinear sampling.  See https://github.com/facebook/Rapid/issues/1650
   *
   * If false, the source is exactly the frame size and is uploaded at the inner
   * bin position, leaving a 1px transparent ring around it.  That's fine for
   * symbols / text / icons, which already fade to transparent at their edges.
   */
  padded: boolean;
  /** False initially, True after the texture has been uploaded to the GPU */
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
  /** Whether atlas sources should be backed by a canvas (for canvas renderer) */
  private _useCanvas: boolean;


  /**
   * Creates an atlas allocator.
   * @constructor
   * @param options - options for the Atlas Allocator
   */
  constructor(options: Partial<AtlasOptions> = {}) {
    this.slabs = [];
    this.label = options.label ?? '';
    this.size = options.size ?? 2048;
    this._useCanvas = options.useCanvas ?? false;
  }


  /**
   * Allocates the given asset, returning a `PIXI.Texture`, or throwing if it could not be done.
   *
   * The source is uploaded directly to the GPU at draw time — no intermediate
   * pixel readback is performed by the atlas.
   *
   * @param source - The pixel source to pack (ImageData, canvas, bitmap, or image)
   * @param width - Inner texture width (the dimensions a sprite using this texture will report)
   * @param height - Inner texture height
   * @param padded - If true, `source` is already `width+2` x `height+2` with a 1px
   *   edge-replicated ring, and the atlas will upload it covering the full bin.
   *   If false, `source` is exactly `width` x `height` and is uploaded at the
   *   inner bin position (1px transparent ring around it).
   * @param textureOptions - optional options to pass to Pixi when creating the texture.
   * @return The issued texture
   * @throws If dimensions will not fit on a slab
   */
  allocate(
    source: AtlasItemSource,
    width: number,
    height: number,
    padded: boolean,
    textureOptions?: PIXI.TextureOptions
  ): AtlasTexture {
    const texture = this._allocateTexture(width, height, textureOptions);
    const uid = texture.uid;
    const slab = texture.source as AtlasSource;

    const item: AtlasItem = {
      uid: uid,
      texture: texture,
      source: source,
      padded: padded,
      uploaded: false
    };

    slab._items.set(uid, item);
    slab._blitItemToCanvas(item);
    slab.update();

    return texture;
  }


  /**
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
    item.source = null;
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
   * Allocates a texture from this allocator.
   * If its existing slab pool has enough space, the texture is issued from one.
   * Otherwise, a new slab is created and the texture is issued from it.
   *
   * @param width - The width of the requested texture.
   * @param height - The height of the requested texture.
   * @param textureOptions - optional options to pass to Pixi when creating the texture.
   * @return The allocated texture, if successful; otherwise, `null`.
   * @throws When dimensions are too large to fit on a slab
   */
  private _allocateTexture(width: number, height: number, textureOptions?: PIXI.TextureOptions): AtlasTexture {
    // We'll always include an extra pixel of padding to avoid color bleeding into neighbor texture.
    const padding = 1;

    // Cannot allocate a texture larger than the slab size.
    if ((width + (2 * padding)) > this.size || (height + (2 * padding)) > this.size) {
      throw new Error(`Texture can not exceed slab size of ${this.size}x${this.size}`);
    }

    // Loop through the slabs and find one with enough space, if any.
    for (const slab of this.slabs) {
      const texture = this._issueTexture(slab, width, height, textureOptions);
      if (texture) return texture;
    }

    // Need another slab.
    const slab = new AtlasSource(this.label, this.size, this._useCanvas);
    this.slabs.push(slab);

    // Issue the texture from this blank slab.
    return this._issueTexture(slab, width, height, textureOptions)!;
  }


  /**
   * Issues a texture from the given texture slab, if possible.
   *
   * @param slab - The texture slab to allocate frame.
   * @param width - The width of the requested texture.
   * @param height - The height of the requested texture.
   * @param textureOptions - optional options to pass to Pixi when creating the texture.
   * @return The issued texture, if successful; otherwise, `null`.
   */
  private _issueTexture(slab: AtlasSource, width: number, height: number, textureOptions?: PIXI.TextureOptions): AtlasTexture | null {
    // We'll always include an extra pixel of padding to avoid color bleeding into neighbor texture.
    const padding = 1;

    const bin = slab._binPacker.allocate(width + (2 * padding), height + (2 * padding));
    if (!bin) return null;

    const texture: AtlasTexture = new PIXI.Texture({
      ...textureOptions,
      source: slab,
      frame: bin.clone().pad(-padding)   // The actual frame shouldn't include the padding
    });

    texture.__bin = bin;   // important to preserve this, it contains `__mem_area`
    return texture;
  }
}



/**
 * An {@code AtlasSource} is used by {@link AtlasAllocator} to manage texture sources.
 * @public
 */
export class AtlasSource extends PIXI.TextureSource<PIXI.BufferSourceOptions> {
  /** Map of texture UID to AtlasItem */
  _items: Map<number, AtlasItem>;
  /** The bin packer for this slab */
  _binPacker: GuilloteneAllocator;
  /** 2D context of the backing canvas, if canvas-backed (for canvas renderer) */
  _canvasCtx: CanvasRenderingContext2D | null;

  /**
   * Creates a TextureSource for the textures in the atlas (aka a "slab")
   * @param label - optional label, can be used for debugging
   * @param size - the size of the textures to create
   * @param useCanvas - if true, create a backing canvas as the resource (for canvas renderer)
   */
  constructor(label: string, size: number, useCanvas: boolean = false) {
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

    // For the canvas renderer, we need a backing canvas as the resource.
    // The canvas renderer reads `source.resource` directly via `canvasUtils.getCanvasSource()`
    // rather than using the upload pipeline, so the pixel data must live on a real canvas.
    if (useCanvas) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      this._canvasCtx = canvas.getContext('2d')!;
      (this as any).resource = canvas;  // type mismatch with BufferSourceOptions, but canvas renderer expects this
    } else {
      this._canvasCtx = null;
    }
  }


  /**
   * Returns the inner-frame position to upload an item at.
   * - padded: upload at outer bin (source includes the 1px ring)
   * - !padded: upload at inner bin (offset by 1px; ring stays transparent)
   * @param item - The atlas item
   * @return [x, y] upload position in slab coordinates
   */
  _uploadOffset(item: AtlasItem): [number, number] {
    const bin = item.texture!.__bin!;
    return item.padded ? [bin.x, bin.y] : [bin.x + 1, bin.y + 1];
  }


  /**
   * Blit an item's source onto the backing canvas (canvas renderer only).
   * This is a no-op if the slab is not canvas-backed.
   * @param item - The atlas item to blit
   */
  _blitItemToCanvas(item: AtlasItem): void {
    if (!this._canvasCtx) return;
    if (!item.source) return;

    const [x, y] = this._uploadOffset(item);
    if (item.source instanceof ImageData) {
      this._canvasCtx.putImageData(item.source, x, y);
    } else {
      this._canvasCtx.drawImage(item.source, x, y);
    }

    item.uploaded = true;
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
      if (item.uploaded || !item.source) continue;

      const [x, y] = slab._uploadOffset(item);
      gl.texSubImage2D(target, 0, x, y, format, type, item.source);

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
      if (item.uploaded || !item.source) continue;

      const [x, y] = slab._uploadOffset(item);
      const src = item.source;
      const w = (src instanceof HTMLImageElement) ? src.naturalWidth : src.width;
      const h = (src instanceof HTMLImageElement) ? src.naturalHeight : src.height;

      gpu.device.queue.copyExternalImageToTexture(
        { source: src },
        { texture: gpuTexture, origin: { x: x, y: y } },
        { width: w, height: h }
      );

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

  switch (renderer.type) {
    case PIXI.RendererType.WEBGL:
      textureSystem._uploads.atlas = glUploadAtlasResource;
      break;
    case PIXI.RendererType.WEBGPU:
      textureSystem._uploads.atlas = gpuUploadAtlasResource;
      break;
  }
  // by default do nothing - texture upload isn't needed for `PIXI.RendererType.CANVAS`
}
