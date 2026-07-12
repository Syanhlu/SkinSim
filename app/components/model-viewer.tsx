"use client";

// Wrapper for Google's <model-viewer> web component: loads its script once
// (next/script dedupes by src) and gives TypeScript a typed intrinsic element
// so GLB previews can be dropped anywhere in the app.

import Script from "next/script";
import type { CSSProperties } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        "camera-controls"?: boolean;
        "auto-rotate"?: boolean;
        "shadow-intensity"?: string;
      };
    }
  }
}

export function ModelViewer({ src, alt, style }: { src: string; alt: string; style?: CSSProperties }) {
  return (
    <>
      <Script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js" />
      <model-viewer src={src} alt={alt} camera-controls auto-rotate shadow-intensity="1" style={style} />
    </>
  );
}
