import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature';
export const Feature = (name: string) => SetMetadata(FEATURE_KEY, name);
