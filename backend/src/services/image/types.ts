/**
 * Image generation provider interface.
 * Decouples the application from specific image generation services.
 */

export interface ImageGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: '1:1' | '3:2' | '4:3' | '16:9';
  seed?: number;
}

export interface ImageGenerateResponse {
  url: string;
  costUsd?: number;
}

export interface ImageProvider {
  readonly id: string;
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse>;
}
