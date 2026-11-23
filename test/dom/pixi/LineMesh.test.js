import * as PIXI from 'pixi.js';
import { LineMesh } from '../../../modules/pixi/lib/LineMesh.ts';
import { geomStrokeMesh } from '../../../modules/geo/stroke.ts';


describe('LineMesh', () => {
  // A line from [0,0] to [10,0] to [10,10]
  const coords = [0, 0, 10, 0, 10, 10];
  const dashTexture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 16, height: 1 }) });

  // The box around what the mesh draws
  function boxOf(mesh) {
    const positions = mesh.geometry.positions;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 2) {
      box[0] = Math.min(box[0], positions[i]);
      box[1] = Math.min(box[1], positions[i + 1]);
      box[2] = Math.max(box[2], positions[i]);
      box[3] = Math.max(box[3], positions[i + 1]);
    }
    return box;
  }

  it('draws nothing until it has a line', () => {
    const mesh = new LineMesh();
    assert.isNull(mesh.strokeMesh);
    assert.lengthOf(mesh.geometry.positions, 0);
    assert.lengthOf(mesh.geometry.indices, 0);
    mesh.destroy();
  });

  it('is always batched, whatever its size', () => {
    const mesh = new LineMesh();
    assert.strictEqual(mesh.geometry.batchMode, 'batch');
    assert.isTrue(mesh.batched);

    const long = [];
    for (let i = 0; i < 200; i++) long.push(i, i % 2);   // a zigzag: more than 100 vertices
    const stroke = geomStrokeMesh(long, { join: 'round' });
    mesh.setStroke(stroke, 0.25);
    assert.isAbove(stroke.vertexCount, 100);
    assert.isTrue(mesh.batched);
    mesh.destroy();
  });

  it('draws a stroke mesh at a width', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    mesh.setStroke(stroke, 1);

    assert.strictEqual(mesh.strokeMesh, stroke);
    assert.lengthOf(mesh.geometry.positions, stroke.vertexCount * 2);
    assert.strictEqual(mesh.geometry.indices, stroke.indices);   // the stroke mesh's own array
    assert.deepEqual(boxOf(mesh), [0, -1, 11, 10]);
    assert.strictEqual(mesh.texture, PIXI.Texture.WHITE);
    mesh.destroy();
  });

  it('moves the vertices it has for a new width', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    mesh.setStroke(stroke, 1);
    const positions = mesh.geometry.positions;
    const buffer = mesh.geometry.getBuffer('aPosition');
    const updates = buffer._updateID;

    mesh.setStroke(stroke, 2);
    assert.strictEqual(mesh.geometry.positions, positions, 'the same array');
    assert.deepEqual(boxOf(mesh), [0, -2, 12, 10]);
    assert.isAbove(buffer._updateID, updates, 'Pixi was told');
  });

  it('does nothing when nothing changed', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    mesh.setStroke(stroke, 1);
    const positionUpdates = mesh.geometry.getBuffer('aPosition')._updateID;
    const uvUpdates = mesh.geometry.getBuffer('aUV')._updateID;

    mesh.setStroke(stroke, 1);
    assert.strictEqual(mesh.geometry.getBuffer('aPosition')._updateID, positionUpdates);
    assert.strictEqual(mesh.geometry.getBuffer('aUV')._updateID, uvUpdates);
    mesh.destroy();
  });

  it('takes new arrays for a new line', () => {
    const mesh = new LineMesh();
    mesh.setStroke(geomStrokeMesh(coords), 1);
    const positions = mesh.geometry.positions;

    const longer = geomStrokeMesh([...coords, 20, 10]);
    mesh.setStroke(longer, 1);
    assert.notStrictEqual(mesh.geometry.positions, positions);
    assert.lengthOf(mesh.geometry.positions, longer.vertexCount * 2);
    assert.strictEqual(mesh.geometry.indices, longer.indices);
    assert.deepEqual(boxOf(mesh), [0, -1, 20, 11]);
    mesh.destroy();
  });

  it('draws a casing and a stroke from one stroke mesh', () => {
    const casing = new LineMesh();
    const line = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    const vertices = stroke.vertices.slice();
    casing.setStroke(stroke, 2);
    line.setStroke(stroke, 1);

    assert.deepEqual(boxOf(casing), [0, -2, 12, 10]);
    assert.deepEqual(boxOf(line), [0, -1, 11, 10]);
    assert.deepEqual(stroke.vertices, vertices, 'the stroke mesh is only read');
    casing.destroy();
    line.destroy();
  });

  it('shares texture coordinates of zero between lines that aren\'t dashed', () => {
    const a = new LineMesh();
    const b = new LineMesh();
    a.setStroke(geomStrokeMesh(coords), 1);
    b.setStroke(geomStrokeMesh([0, 0, 5, 5]), 1);

    assert.strictEqual(a.geometry.uvs, b.geometry.uvs);
    assert.isAtLeast(a.geometry.uvs.length, a.geometry.positions.length);
    assert.isTrue(a.geometry.uvs.every(n => n === 0));
    a.destroy();
    b.destroy();
  });

  it('gives a dashed line texture coordinates that count the pattern along it', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);   // 20 long
    mesh.setStroke(stroke, 1, dashTexture, 5);

    assert.strictEqual(mesh.texture, dashTexture);
    const uvs = mesh.geometry.uvs;
    assert.lengthOf(uvs, stroke.vertexCount * 2);
    let maxU = -Infinity;
    for (let i = 0; i < uvs.length; i += 2) maxU = Math.max(maxU, uvs[i]);
    assert.closeTo(maxU, 4, 1e-6, 'four repeats of a pattern 5 long');
    mesh.destroy();
  });

  it('works the texture coordinates out again when the pattern changes length', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    mesh.setStroke(stroke, 1, dashTexture, 5);
    const uvs = mesh.geometry.uvs;

    mesh.setStroke(stroke, 1, dashTexture, 10);   // as after a zoom
    assert.strictEqual(mesh.geometry.uvs, uvs, 'the same array');
    let maxU = -Infinity;
    for (let i = 0; i < uvs.length; i += 2) maxU = Math.max(maxU, uvs[i]);
    assert.closeTo(maxU, 2, 1e-6);
    mesh.destroy();
  });

  it('goes back to a solid line', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    mesh.setStroke(stroke, 1, dashTexture, 5);
    mesh.setStroke(stroke, 1);

    assert.strictEqual(mesh.texture, PIXI.Texture.WHITE);
    assert.isTrue(mesh.geometry.uvs.every(n => n === 0));
    mesh.destroy();
  });

  it('draws nothing again after clear()', () => {
    const mesh = new LineMesh();
    mesh.setStroke(geomStrokeMesh(coords), 1);
    mesh.clear();

    assert.isNull(mesh.strokeMesh);
    assert.lengthOf(mesh.geometry.positions, 0);
    assert.lengthOf(mesh.geometry.indices, 0);
    mesh.destroy();
  });

  it('destroys its geometry with it', () => {
    const mesh = new LineMesh();
    const stroke = geomStrokeMesh(coords);
    mesh.setStroke(stroke, 1);
    const geometry = mesh.geometry;
    mesh.destroy();

    assert.isTrue(mesh.destroyed);
    assert.isNull(geometry.attributes, 'Pixi clears a destroyed geometry');
    assert.isAbove(stroke.indices.length, 0, 'the stroke mesh is left as it was');
  });
});
