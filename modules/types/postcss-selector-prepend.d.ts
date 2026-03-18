declare module 'postcss-selector-prepend' {
  import type { Plugin } from 'postcss';

  interface PrependOptions {
    selector: string;
  }

  function prepend(opts: PrependOptions): Plugin;
  export default prepend;
}
