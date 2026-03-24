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

export type Platform = 'cursor' | 'kiro' | 'windsurf';

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

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/** Platform display metadata */
export const PlatformMeta: Record<Platform, { label: string; emoji: string; color: string }> = {
  cursor: { label: 'Cursor', emoji: '🖥️', color: '#8b5cf6' },
  kiro: { label: 'Kiro', emoji: '🎯', color: '#f97316' },
  windsurf: { label: 'Windsurf', emoji: '🏄', color: '#0ea5e9' },
};
