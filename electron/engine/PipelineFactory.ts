/**
 * PipelineFactory — creates platform-specific registration step arrays
 * Unifies Cursor, Kiro, and Windsurf under one common RegistrationPipeline
 */

import type { RegistrationStep } from './steps/types';

// Cursor Steps
import {
  NavigateToSignupStep,
  FillEmailStep,
  FillDetailsStep,
  HandleCaptchaStep,
  SubmitVerificationCodeStep,
  ExtractTokenStep,
} from './steps/RegistrationSteps';

// Kiro Steps
import {
  KiroNavigateStep,
  KiroFillEmailStep,
  KiroFillNameStep,
  KiroVerificationStep,
  KiroAuthorizeStep,
  KiroBindCardStep,
  KiroExtractTokenStep,
} from './steps/KiroSteps';

// Windsurf Steps
import {
  WindsurfNavigateStep,
  WindsurfFillEmailStep,
  WindsurfFillDetailsStep,
  WindsurfCaptchaStep,
  WindsurfVerificationStep,
  WindsurfExtractTokenStep,
} from './steps/WindsurfSteps';

import {
  OpenAINavigateStep,
  OpenAIFillCredentialsStep,
  OpenAIArkoseBypassStep,
  OpenAIPhoneVerificationStep,
  OpenAIExtractSessionStep,
} from './steps/OpenAISteps';

// Claude Steps
import {
  ClaudeNavigateStep,
  ClaudeFillEmailStep,
  ClaudePhoneVerificationStep,
  ClaudeExtractSessionStep,
} from './steps/ClaudeSteps';

// Antigravity (Google) Steps
import {
  AntigravityNavigateSignupStep,
  AntigravityFillDetailsStep,
  AntigravitySelectEmailStep,
  AntigravityPhoneVerificationStep,
  AntigravityOAuthConsentStep,
} from './steps/AntigravitySteps';

export type Platform = 'cursor' | 'kiro' | 'windsurf' | 'openai' | 'claude' | 'antigravity';

export function createPipelineSteps(platform: Platform): RegistrationStep[] {
  switch (platform) {
    case 'cursor':
      return [
        new NavigateToSignupStep(),
        new FillEmailStep(),
        new FillDetailsStep(),
        new HandleCaptchaStep(),
        new SubmitVerificationCodeStep(),
        new ExtractTokenStep(),
      ];

    case 'kiro':
      return [
        new KiroNavigateStep(),
        new KiroFillEmailStep(),
        new KiroFillNameStep(),
        new KiroVerificationStep(),
        new KiroAuthorizeStep(),
        new KiroBindCardStep(),
        new KiroExtractTokenStep(),
      ];

    case 'windsurf':
      return [
        new WindsurfNavigateStep(),
        new WindsurfFillEmailStep(),
        new WindsurfFillDetailsStep(),
        new WindsurfCaptchaStep(),
        new WindsurfVerificationStep(),
        new WindsurfExtractTokenStep(),
      ];

    case 'openai':
      return [
        new OpenAINavigateStep(),
        new OpenAIFillCredentialsStep(),
        new OpenAIArkoseBypassStep(),
        new OpenAIPhoneVerificationStep(),
        new OpenAIExtractSessionStep(),
      ];

    case 'claude':
      return [
        new ClaudeNavigateStep(),
        new ClaudeFillEmailStep(),
        new ClaudePhoneVerificationStep(),
        new ClaudeExtractSessionStep()
      ];

    case 'antigravity':
      return [
        new AntigravityNavigateSignupStep(),
        new AntigravityFillDetailsStep(),
        new AntigravitySelectEmailStep(),
        new AntigravityPhoneVerificationStep(),
        new AntigravityOAuthConsentStep()
      ];

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/** Platform display metadata */
export const PlatformMeta: Record<Platform, { label: string; emoji: string; color: string }> = {
  cursor: { label: 'Cursor', emoji: '🖥️', color: '#8b5cf6' },
  kiro: { label: 'Kiro', emoji: '🎯', color: '#f97316' },
  windsurf: { label: 'Windsurf', emoji: '🏄', color: '#0ea5e9' },
  openai: { label: 'OpenAI', emoji: '🤖', color: '#10a37f' },
  claude: { label: 'Claude', emoji: '🧠', color: '#d97757' },
  antigravity: { label: 'Antigravity', emoji: '🛸', color: '#4285F4' },
};

