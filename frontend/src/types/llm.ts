export type LlmProvider = 'bedrock';

export interface LlmConfig {
  defaultProvider: LlmProvider;
  providers: {
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
