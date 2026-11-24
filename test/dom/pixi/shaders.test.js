import { FillBatchMesh } from '../../../modules/pixi/lib/FillBatchMesh.ts';
import { LineBatchMesh } from '../../../modules/pixi/lib/LineBatchMesh.ts';
import { PointBatchMesh } from '../../../modules/pixi/lib/PointBatchMesh.ts';


// Each batch has its shader twice: in GLSL for WebGL, and in WGSL for WebGPU. Nothing here
// compiles them (the e2e tests draw with the GLSL ones), so a mistake that only WGSL makes is
// found when someone looks at the map with `renderer=webgpu`, and sees none. This checks for
// the one that has happened: a name that WGSL keeps for itself (`from`), which GLSL allows.
describe('the batches\' WGSL shaders', () => {
  // https://www.w3.org/TR/WGSL/#keyword-summary and #reserved-words
  const KEYWORDS = 'alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override requires return struct switch true var while';
  const RESERVED = 'NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become binding_array cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation non_coherent noncopyable noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield';
  const taken = new Set([...KEYWORDS.split(' '), ...RESERVED.split(' ')]);

  // The names a shader declares: variables, functions, structs, and what has a type after a colon
  // (parameters and members)
  function declared(source) {
    const code = source.replace(/\/\/.*$/gm, '');
    const names = new Set();
    for (const match of code.matchAll(/\b(?:let|var(?:<[^>]*>)?|const|fn|struct|alias|override)\s+([A-Za-z_]\w*)/g)) {
      names.add(match[1]);
    }
    for (const match of code.matchAll(/\b([A-Za-z_]\w*)\s*:\s*[A-Za-z_]/g)) {
      names.add(match[1]);
    }
    return names;
  }

  const shaders = {
    LineBatchMesh: () => new LineBatchMesh(),
    FillBatchMesh: () => new FillBatchMesh(),
    PointBatchMesh: () => new PointBatchMesh()
  };

  for (const [name, make] of Object.entries(shaders)) {
    it(`${name} declares nothing by a name that WGSL keeps for itself`, () => {
      const batch = make();
      const program = batch.shader.gpuProgram;
      for (const stage of [program.vertex, program.fragment]) {
        const names = declared(stage.source);
        assert.isAbove(names.size, 5, 'the names were found');
        assert.deepEqual([...names].filter(n => taken.has(n)), []);
      }
      batch.destroy();
    });
  }

  it('finds such a name where there is one', () => {
    assert.deepEqual([...declared('let from = select(a, b, c);\n  // let target = 1;\n fn main(filter: f32) {}')].filter(n => taken.has(n)), ['from', 'filter']);
  });
});
