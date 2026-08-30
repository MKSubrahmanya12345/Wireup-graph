export type LlmProvider = 'groq' | 'bedrock';

export interface LlmConfig {
  defaultProvider: LlmProvider;
  providers: {
    groq: {
      available: boolean;
      defaultModel: string;
      baseUrl: string;
      models: string[];
    };
    bedrock: {
      available: boolean;
      defaultModel: string;
      region: string;
      models: string[];
    };
  };
}

export interface LlmOptions {
  provider?: LlmProvider;
  model?: string;
}
