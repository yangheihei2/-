export {};

declare global {
  interface Window {
    Tesseract?: {
      recognize: (input: File, lang: string) => Promise<{ data: { text?: string } }>;
    };
  }
}
