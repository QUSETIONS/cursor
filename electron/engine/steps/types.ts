import { Page } from 'puppeteer-core';

export interface RegistrationStep {
  name: string;
  retryable: boolean;
  execute(context: StepContext): Promise<StepResult>;
}

export interface StepContext {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  browser?: any;
  page?: Page | any;
  imapService?: any;
  imapAccounts?: Array<{ email: string; password: string; host: string; port: number }>;
  config: StepConfig;
  data: Map<string, unknown>;
  onProgress: (step: string, progress: number) => void;
  fetchToken?: boolean;
  deleteMailAfterRead?: boolean;
  captchaConfig?: any;
  [key: string]: any;
}

export interface StepConfig {
  deleteMailAfterRead: boolean;
  fetchTokenAfterRegister: boolean;
  timeout: number;
  bindCardData?: {
    number: string;
    expMonth: string;
    expYear: string;
    cvc: string;
    name?: string;
    zip?: string;
  };
}

export interface StepResult {
  success: boolean;
  retryable?: boolean;
  error?: string;
  data?: Record<string, unknown>;
  skip?: boolean;
}
