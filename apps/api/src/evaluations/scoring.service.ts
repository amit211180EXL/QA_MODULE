import { Injectable } from '@nestjs/common';
import {
  FormQuestion,
  FormSection,
  ScoringStrategy,
  AnswerRecord,
  EvaluationResponseLayer,
} from '@qa/shared';

export interface ScoreResult extends EvaluationResponseLayer {
  computation: {
    sectionBreakdown: Record<
      string,
      { title: string; raw: number; weight: number; weighted: number; questionCount: number }
    >;
    passMark: number;
    scale: number;
  };
}

@Injectable()
export class ScoringService {
  score(
    answers: Record<string, AnswerRecord>,
    questions: FormQuestion[],
    sections: FormSection[],
    strategy: ScoringStrategy,
  ): ScoreResult {
    const passMark = strategy.passMark ?? 70;
    const scale = strategy.scale ?? 100;
    const roundingPolicy = strategy.roundingPolicy;

    // Build lookup maps
    const questionsBySection = new Map<string, FormQuestion[]>();
    for (const q of questions) {
      if (!questionsBySection.has(q.sectionId)) questionsBySection.set(q.sectionId, []);
      questionsBySection.get(q.sectionId)!.push(q);
    }

    const sectionScores: Record<string, number> = {};
    const sectionBreakdown: ScoreResult['computation']['sectionBreakdown'] = {};
    let totalWeight = 0;
    let weightedTotal = 0;

    for (const section of sections) {
      const qs = questionsBySection.get(section.id) ?? [];
      if (!qs.length) continue;

      const totalQWeight = qs.reduce((sum, q) => sum + q.weight, 0);
      let sectionRaw = 0;

      for (const q of qs) {
        const answer = answers[q.key];
        if (!answer) continue;
        const normalized = this.normalizeAnswer(answer.value, q, scale);
        sectionRaw += (normalized / scale) * q.weight;
      }

      const sectionScore = totalQWeight > 0 ? (sectionRaw / totalQWeight) * scale : 0;
      const rounded = this.applyRounding(sectionScore, roundingPolicy);

      sectionScores[section.id] = rounded;
      sectionBreakdown[section.id] = {
        title: section.title,
        raw: rounded,
        weight: section.weight,
        weighted: rounded * section.weight,
        questionCount: qs.length,
      };

      totalWeight += section.weight;
      weightedTotal += rounded * section.weight;
    }

    const overallRaw = totalWeight > 0 ? weightedTotal / totalWeight : 0;
    const overallScore = this.applyRounding(overallRaw, roundingPolicy);
    const passFail = overallScore >= passMark;

    return {
      answers,
      sectionScores,
      overallScore,
      passFail,
      computation: { sectionBreakdown, passMark, scale },
    };
  }

  private normalizeAnswer(value: unknown, q: FormQuestion, scale: number): number {
    switch (q.type) {
      case 'rating': {
        if (typeof value !== 'number') return 0;
        const min = q.validation?.min ?? 0;
        const max = q.validation?.max ?? 5;
        return this.scaleValue(value, min, max, scale);
      }
      case 'boolean':
        return value === true || value === 1 || value === 'yes' || value === 'true' ? scale : 0;
      case 'select':
      case 'multiselect': {
        // Numeric value embedding in option value like "3/5"
        if (typeof value === 'number') {
          if (q.validation?.max !== undefined || q.validation?.min !== undefined) {
            return this.scaleValue(value, q.validation?.min ?? 0, q.validation?.max ?? scale, scale);
          }
          return value;
        }
        if (typeof value === 'string') {
          const parsed = parseFloat(value);
          if (isNaN(parsed)) return 0;
          if (q.validation?.max !== undefined || q.validation?.min !== undefined) {
            return this.scaleValue(parsed, q.validation?.min ?? 0, q.validation?.max ?? scale, scale);
          }
          return parsed;
        }
        return 0;
      }
      default:
        return 0;
    }
  }

  private scaleValue(value: number, min: number, max: number, scale: number): number {
    if (max <= min) {
      return Math.min(Math.max(value, 0), scale);
    }

    const clamped = Math.min(Math.max(value, min), max);
    return ((clamped - min) / (max - min)) * scale;
  }

  private applyRounding(value: number, policy: ScoringStrategy['roundingPolicy']): number {
    switch (policy) {
      case 'floor':
        return Math.floor(value * 100) / 100;
      case 'ceil':
        return Math.ceil(value * 100) / 100;
      default:
        return Math.round(value * 100) / 100;
    }
  }
}
