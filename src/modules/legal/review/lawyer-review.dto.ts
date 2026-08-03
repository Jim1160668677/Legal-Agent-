/**
 * LawyerReviewController DTO（v2.3 阶段十，17 §2-§6 + 06-api-spec）。
 *
 * 配合全局 ValidationPipe（whitelist + forbidNonWhitelisted + transform），
 * 所有字段均带 class-validator 装饰器，非法入参在管道层拦截返回 400。
 *
 * 设计依据：17 §2.4 标注字段；06-api-spec 律师审核端点。
 */
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

// ===== 提交标注 DTO（17 §2.4）=====

export class LawyerScoresDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  accuracy!: number;

  @IsNumber()
  @Min(1)
  @Max(5)
  completeness!: number;

  @IsNumber()
  @Min(1)
  @Max(5)
  compliance!: number;

  @IsNumber()
  @Min(1)
  @Max(5)
  usefulness!: number;
}

export class CitationErrorDto {
  @IsString()
  lawRef!: string;

  @IsString()
  errorType!: string;

  @IsString()
  correction!: string;
}

export class FactCorrectionDto {
  @IsString()
  segment!: string;

  @IsString()
  correction!: string;
}

export class ReasoningFlawDto {
  @IsString()
  step!: string;

  @IsString()
  flaw!: string;

  @IsString()
  suggestion!: string;
}

export class TextAnnotationsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CitationErrorDto)
  citationErrors?: CitationErrorDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FactCorrectionDto)
  factCorrections?: FactCorrectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReasoningFlawDto)
  reasoningFlaws?: ReasoningFlawDto[];

  @IsOptional()
  @IsString()
  generalComment?: string;
}

export class SubmitReviewDto {
  @ValidateNested()
  @Type(() => LawyerScoresDto)
  scores!: LawyerScoresDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TextAnnotationsDto)
  textAnnotations?: TextAnnotationsDto;

  @IsEnum(['none', 'low', 'high'])
  riskFlag!: 'none' | 'low' | 'high';

  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number;
}

// ===== 触发回流 DTO（17 §6.3）=====

export class ReflowDto {
  @IsOptional()
  @IsString()
  reasoningChainId?: string;

  @IsOptional()
  @IsNumber()
  qualityScore?: number;
}

// ===== 合规扫描 DTO（17 §5）=====

export class ComplianceScanDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  citationFailureRate?: number;

  @IsOptional()
  @IsEnum(['none', 'low', 'high'])
  lawyerRiskFlag?: 'none' | 'low' | 'high';
}
