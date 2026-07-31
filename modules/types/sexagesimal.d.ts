declare module '@mapbox/sexagesimal' {
  export function pair(str: string, dims?: string): any;
  export function format(deg: number, dim?: string): string;
}
