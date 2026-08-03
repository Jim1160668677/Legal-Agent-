/**
 * VisionController — 图像识别 REST API（v2.4）。
 *
 * 端点（全部 JWT 鉴权）：
 *   POST /v1/vision/recognize  (Body: { image, prompt? })      → 识别 URL/Base64 图片
 *   POST /v1/vision/upload      (multipart: file + prompt?)      → 识别上传文件
 *   GET  /v1/vision/health                                      → 各 provider 健康状态
 *
 * 响应信封由全局 ResponseInterceptor 统一包装为：
 *   { code: 0, message: 'ok', traceId, data: {...} }
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.5
 */
import {
  Controller,
  Post,
  Get,
  Body,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { VisionService } from './vision.service';
import { RecognizeDto, UploadDto } from './vision.dto';

@ApiTags('vision')
@ApiBearerAuth()
@Controller('v1/vision')
@UseGuards(JwtAuthGuard)
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Post('recognize')
  @ApiOperation({ summary: '图像识别（URL / Base64）' })
  recognize(@Body() dto: RecognizeDto) {
    return this.visionService.recognize({ image: dto.image, prompt: dto.prompt });
  }

  @Post('upload')
  @ApiOperation({ summary: '图像识别（文件上传）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        prompt: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadDto) {
    if (!file) {
      throw new BadRequestException({ code: 8001, message: '缺少上传文件 file' });
    }
    const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    return this.visionService.recognize({ image: base64, prompt: dto.prompt });
  }

  @Get('health')
  @ApiOperation({ summary: '视觉模型健康状态' })
  health() {
    return { providers: this.visionService.getProviderStatus() };
  }
}
