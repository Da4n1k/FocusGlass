/// <reference types="vite/client" />

/** Application version injected from package.json by Vite (see vite.config.ts). */
declare const __APP_VERSION__: string;

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}
