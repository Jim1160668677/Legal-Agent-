/**
 * Vision 模块 DTO + 校验（v2.4）。
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.6
 */
import { IsString, IsOptional, MaxLength } from 'class-validator';

/** POST /v1/vision/recognize 入参 */
export class RecognizeDto {
  /** 图片 URL 或 data:image/...;base64,... */
  @IsString()
  image!: string;

  /** 识别指令（可选，最长 500） */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  prompt?: string;
}

/** POST /v1/vision/upload 入参（file 由 @UploadedFile 接收，不在 DTO 内） */
export class UploadDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  prompt?: string;
}
