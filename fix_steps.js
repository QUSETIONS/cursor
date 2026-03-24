const fs = require('fs');
const path = require('path');

const files = [
  'd:/Desktop/cursor/nirvana-rebuild/electron/engine/steps/RegistrationSteps.ts',
  'd:/Desktop/cursor/nirvana-rebuild/electron/engine/steps/KiroSteps.ts',
  'd:/Desktop/cursor/nirvana-rebuild/electron/engine/steps/WindsurfSteps.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf-8');
  
  // 1. Remove old interfaces
  // In RegistrationSteps.ts
  content = content.replace(/\/\*\*\n \* Registration step interface[\s\S]*?\/\nexport interface StepResult \{[\s\S]*?\}/, '');
  
  // In KiroSteps.ts and WindsurfSteps.ts
  content = content.replace(/\/\/ ─── Step Interface[\s\S]*?export interface StepResult \{[\s\S]*?\}/, '');
  
  // Remove import { Page } from 'puppeteer-core'; if present
  content = content.replace(/import \{ Page \} from 'puppeteer-core';\n?/, '');
  
  // Add new import
  if (!content.includes("from './types'")) {
    const importStatement = `import { RegistrationStep, StepContext, StepResult, StepConfig } from './types';\n`;
    if (content.includes("import { Logger }")) {
      content = content.replace("import { Logger } from '../../utils/Logger';", `import { Logger } from '../../utils/Logger';\n` + importStatement);
    } else {
      content = importStatement + '\n' + content;
    }
  }

  // 2. Fix execute signatures in Kiro/Windsurf
  // async execute(page: Page): Promise<StepResult> {
  // async execute(page: Page, ctx: StepContext): Promise<StepResult> {
  // async execute(ctx: StepContext): Promise<StepResult> {
  
  content = content.replace(/async execute\(page: any\): Promise<StepResult> \{/g, 'async execute(ctx: StepContext): Promise<StepResult> {\n    const page = ctx.page;');
  content = content.replace(/async execute\(page: Page\): Promise<StepResult> \{/g, 'async execute(ctx: StepContext): Promise<StepResult> {\n    const page = ctx.page;');
  
  content = content.replace(/async execute\(page: any, ctx: StepContext\): Promise<StepResult> \{/g, 'async execute(ctx: StepContext): Promise<StepResult> {\n    const page = ctx.page;');
  content = content.replace(/async execute\(page: Page, ctx: StepContext\): Promise<StepResult> \{/g, 'async execute(ctx: StepContext): Promise<StepResult> {\n    const page = ctx.page;');

  fs.writeFileSync(file, content);
}

// Fix PipelineFactory
const pf = 'd:/Desktop/cursor/nirvana-rebuild/electron/engine/PipelineFactory.ts';
let pfContent = fs.readFileSync(pf, 'utf-8');
pfContent = pfContent.replace("import type { RegistrationStep } from './steps/KiroSteps';", "import type { RegistrationStep } from './steps/types';");
fs.writeFileSync(pf, pfContent);

console.log('Update completed');
