/**
 * KnowledgeController —— 法律知识 REST 端点（A2-W1）。
 *
 * 端点：
 *   GET /v1/knowledge              分页列表（type/category/keyword/page/pageSize）
 *   GET /v1/knowledge/categories   分类聚合（前端 tab 用）
 *   GET /v1/knowledge/:id          单条详情
 *
 * 所有端点使用 KnowledgeBaseService 查询，失败降级返回空/404，不影响主流程。
 */
import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import type {
  KnowledgeListResult,
  KnowledgeCategoryInfo,
  KnowledgeArticleDto,
} from './knowledge.types';

@Controller('v1/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeBaseService) {}

  /**
   * 分页列表查询。
   * query: type, category, keyword, page, pageSize
   */
  @Get()
  async list(
    @Query('type') type?: string,
    @Query('category') category?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<KnowledgeListResult> {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedPageSize = pageSize ? parseInt(pageSize, 10) : undefined;

    if (parsedPage && parsedPage < 1) {
      throw new BadRequestException('page must be >= 1');
    }
    if (parsedPageSize && (parsedPageSize < 1 || parsedPageSize > 50)) {
      throw new BadRequestException('pageSize must be 1-50');
    }

    return this.knowledgeService.list({
      type,
      category,
      keyword,
      page: parsedPage,
      pageSize: parsedPageSize,
    });
  }

  /**
   * 分类聚合查询（用于前端 type/category tabs）。
   */
  @Get('categories')
  async categories(): Promise<KnowledgeCategoryInfo[]> {
    return this.knowledgeService.listCategories();
  }

  /**
   * 单条知识详情（用于详情页）。
   */
  @Get(':id')
  async getById(@Param('id') id: string): Promise<KnowledgeArticleDto> {
    if (!id || id.trim() === '') {
      throw new BadRequestException('id is required');
    }
    const doc = await this.knowledgeService.getDetailById(id);
    if (!doc) {
      throw new NotFoundException('knowledge not found');
    }
    return doc;
  }
}
