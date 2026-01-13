declare module '*.wasm?url' {
  const url: string;
  export default url;
}

declare module '@vlcn.io/wa-sqlite/dist/crsqlite.mjs' {
  const factory: (options?: { locateFile?: (file: string) => string }) => Promise<any>;
  export default factory;
}
